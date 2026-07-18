import Foundation
import Network
import UIKit

struct DesktopService: Identifiable, Equatable {
    let endpoint: NWEndpoint
    private let displayName: String?
    private let displaySubtitle: String?

    init(endpoint: NWEndpoint, displayName: String? = nil, displaySubtitle: String? = nil) {
        self.endpoint = endpoint
        self.displayName = displayName
        self.displaySubtitle = displaySubtitle
    }

    var id: String { String(describing: endpoint) }

    var name: String {
        if let displayName, !displayName.isEmpty { return displayName }
        guard case let .service(name, _, _, _) = endpoint else { return "LumaStage Desktop" }
        return name
    }

    var subtitle: String { displaySubtitle ?? "Local network · LumaLink v1" }

    var credentialAccount: String {
        switch endpoint {
        case let .service(name, type, domain, _):
            return "service:\(name).\(type).\(domain)"
        case let .hostPort(host, port):
            return "host:\(Self.hostString(host)):\(port.rawValue)"
        default:
            return id
        }
    }

    /// Manual IPv4/hostname endpoint — prefer URLSession WebSocket for reliability on Windows LANs.
    var manualHostPort: (host: String, port: UInt16)? {
        guard case let .hostPort(host, port) = endpoint else { return nil }
        return (Self.hostString(host), port.rawValue)
    }

    static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        case let .ipv4(address):
            return "\(address)"
        case let .ipv6(address):
            return "\(address)"
        case let .name(name, _):
            return name
        @unknown default:
            // Avoid String(describing:) quirks like optional wrappers.
            let raw = "\(host)"
            return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        }
    }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}

@MainActor
final class DesktopConnection: ObservableObject {
    @Published private(set) var services: [DesktopService] = []
    @Published private(set) var connectedService: DesktopService?
    @Published private(set) var isConnected = false
    @Published private(set) var isConnecting = false
    @Published private(set) var errorMessage: String?

    private var browser: NWBrowser?
    private var connection: NWConnection?
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var pendingService: DesktopService?
    private var enteredPairingCode = ""
    private var receiveGeneration = 0
    private var helloAttempts = 0

    private static let lastHostKey = "lumastage.lastManualHost"
    private static let lastPortKey = "lumastage.lastManualPort"
    static let defaultPort: UInt16 = 39510

    var lastManualHost: String {
        get { UserDefaults.standard.string(forKey: Self.lastHostKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: Self.lastHostKey) }
    }

    var lastManualPort: String {
        get {
            let stored = UserDefaults.standard.string(forKey: Self.lastPortKey)
            if let stored, !stored.isEmpty { return stored }
            return String(Self.defaultPort)
        }
        set { UserDefaults.standard.set(newValue, forKey: Self.lastPortKey) }
    }

    func startBrowsing() {
        guard browser == nil else { return }
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        parameters.prohibitedInterfaceTypes = [.cellular]
        let browser = NWBrowser(for: .bonjour(type: "_lumastage._tcp", domain: nil), using: parameters)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.map { DesktopService(endpoint: $0.endpoint) }.sorted { $0.name < $1.name }
            Task { @MainActor in self?.services = found }
        }
        browser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                if case let .failed(error) = state {
                    self?.errorMessage = "Discovery failed: \(error.localizedDescription). Use manual IP below."
                }
            }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func connect(to service: DesktopService, pairingCode: String) {
        openConnection(to: service, pairingCode: pairingCode)
    }

    /// Direct WebSocket connect by IPv4/hostname + port (Wi‑Fi, Ethernet, or USB tether).
    func connect(host rawHost: String, port rawPort: String, pairingCode: String) {
        let host = rawHost.trimmingCharacters(in: .whitespacesAndNewlines)
        let portText = rawPort.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else {
            errorMessage = "Enter the desktop IP address"
            return
        }
        guard let portValue = UInt16(portText), portValue >= 1 else {
            errorMessage = "Enter a valid port (default \(Self.defaultPort))"
            return
        }
        guard let port = NWEndpoint.Port(rawValue: portValue) else {
            errorMessage = "Invalid port"
            return
        }

        lastManualHost = host
        lastManualPort = portText

        let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: port)
        let service = DesktopService(
            endpoint: endpoint,
            displayName: "\(host):\(portValue)",
            displaySubtitle: "Manual · LumaLink v1"
        )
        openConnection(to: service, pairingCode: pairingCode)
    }

    func send(_ frame: TrackingFrame) {
        guard isConnected, let data = frame.jsonData else { return }
        send(data)
    }

    func stop() {
        browser?.cancel()
        browser = nil
        tearDownTransport()
        isConnected = false
        isConnecting = false
        connectedService = nil
        pendingService = nil
    }

    func hasStoredCredential(for service: DesktopService) -> Bool {
        CredentialStore.token(for: credentialKey(for: service)) != nil
    }

    private func tearDownTransport() {
        receiveGeneration += 1
        connection?.cancel()
        connection = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        urlSession?.invalidateAndCancel()
        urlSession = nil
        helloAttempts = 0
    }

    /// Keep only ASCII digits so one-time-code paste / keyboard quirks cannot break pairing.
    private static func normalizePairingCode(_ raw: String) -> String {
        String(raw.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) })
    }

    private func openConnection(to service: DesktopService, pairingCode: String) {
        tearDownTransport()
        errorMessage = nil
        isConnected = false
        isConnecting = true
        pendingService = service
        enteredPairingCode = Self.normalizePairingCode(pairingCode)

        // Manual pair: always prefer the typed 6-digit code over any leftover Keychain token.
        if !enteredPairingCode.isEmpty {
            CredentialStore.removeToken(for: credentialKey(for: service))
        }

        if let manual = service.manualHostPort {
            openURLSessionWebSocket(to: service, host: manual.host, port: manual.port)
            return
        }

        openNetworkFrameworkWebSocket(to: service)
    }

    private func openURLSessionWebSocket(to service: DesktopService, host: String, port: UInt16) {
        guard let url = URL(string: "ws://\(host):\(port)/") else {
            errorMessage = "Invalid host/port"
            isConnecting = false
            return
        }

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config)
        let task = session.webSocketTask(with: url)
        urlSession = session
        webSocketTask = task
        task.resume()

        // Start receive first, then send hello after the socket has a moment to open.
        // Immediate send-on-resume can race the handshake on some iOS builds.
        receiveURLSessionLoop(for: service, task: task)
        scheduleHello(for: service, attempt: 0)
    }

    private func scheduleHello(for service: DesktopService, attempt: Int) {
        helloAttempts = attempt
        let delays: [UInt64] = [80_000_000, 250_000_000, 600_000_000] // 80ms, 250ms, 600ms
        let delay = delays[min(attempt, delays.count - 1)]
        let generation = receiveGeneration
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: delay)
            guard self.receiveGeneration == generation else { return }
            guard self.isConnecting, !self.isConnected else { return }
            guard self.pendingService == service else { return }
            self.sendHello(for: service)
            if attempt + 1 < delays.count, self.isConnecting, !self.isConnected {
                self.scheduleHello(for: service, attempt: attempt + 1)
            }
        }
    }

    private func openNetworkFrameworkWebSocket(to service: DesktopService) {
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        parameters.includePeerToPeer = true
        parameters.prohibitedInterfaceTypes = [.cellular]

        let connection = NWConnection(to: service.endpoint, using: parameters)
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                guard self.connection === connection else { return }
                switch state {
                case .ready:
                    self.sendHello(for: service)
                    self.receiveNetworkLoop(on: connection)
                case let .failed(error):
                    self.errorMessage = self.friendlyError(error)
                    self.isConnected = false
                    self.isConnecting = false
                    self.connectedService = nil
                case .cancelled:
                    self.isConnected = false
                    self.isConnecting = false
                    self.connectedService = nil
                case let .waiting(error):
                    self.errorMessage = self.friendlyError(error)
                default:
                    break
                }
            }
        }
        connection.start(queue: .main)
        self.connection = connection
    }

    private func friendlyError(_ error: NWError) -> String {
        if case let .posix(code) = error {
            if code == .ECONNREFUSED {
                return "Connection refused. Is LumaStage Desktop running? Check Windows Firewall for port \(Self.defaultPort)."
            }
            if code == .ETIMEDOUT || code == .ENETUNREACH || code == .EHOSTUNREACH {
                return "Unreachable. Same Wi‑Fi/Ethernet/USB network? Use the first (LAN) IP from Desktop — not VPN/Tailscale."
            }
        }
        return error.localizedDescription
    }

    private func friendlyURLError(_ error: Error) -> String {
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain {
            switch ns.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost:
                return "Connection refused/lost. Is Desktop running? Firewall TCP \(Self.defaultPort)? Same LAN?"
            case NSURLErrorTimedOut, NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
                return "Timed out. Phone and PC must share Wi‑Fi/Ethernet/USB hotspot. Prefer the 192.168.x IP from Desktop."
            case NSURLErrorNotConnectedToInternet:
                return "No network on iPhone. Join the same LAN as the PC (or USB Personal Hotspot)."
            default:
                break
            }
        }
        return error.localizedDescription
    }

    private func resolveAuthToken(for service: DesktopService) -> String {
        // Typed pairing code always wins.
        if enteredPairingCode.count == 6 { return enteredPairingCode }
        if !enteredPairingCode.isEmpty { return enteredPairingCode }
        return CredentialStore.token(for: credentialKey(for: service)) ?? ""
    }

    private func sendHello(for service: DesktopService) {
        let token = resolveAuthToken(for: service)
        var payload: [String: Any] = [
            "type": "hello",
            "protocol": 1,
            "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString,
            "deviceName": UIDevice.current.name,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.1"
        ]
        // Always include token key when we have anything; empty means first-time without code (will be rejected).
        if !token.isEmpty {
            payload["token"] = token
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
        send(data)
    }

    private func send(_ data: Data) {
        if let task = webSocketTask {
            guard let text = String(data: data, encoding: .utf8) else { return }
            task.send(.string(text)) { [weak self] error in
                Task { @MainActor in
                    guard let self else { return }
                    // Ignore send errors after we already connected successfully.
                    if let error, self.isConnecting, !self.isConnected {
                        // Keep trying other hello attempts; only surface if we stay disconnected.
                        self.errorMessage = self.friendlyURLError(error)
                    }
                }
            }
            return
        }

        let context = NWConnection.ContentContext(identifier: "lumalink", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection?.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func receiveURLSessionLoop(for service: DesktopService, task: URLSessionWebSocketTask) {
        let generation = receiveGeneration
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                guard self.receiveGeneration == generation, self.webSocketTask === task else { return }
                switch result {
                case let .failure(error):
                    if self.isConnecting || self.isConnected {
                        self.errorMessage = self.friendlyURLError(error)
                        self.isConnecting = false
                        self.isConnected = false
                        self.connectedService = nil
                    }
                case let .success(message):
                    switch message {
                    case let .string(text):
                        if let data = text.data(using: .utf8) { self.handleServerMessage(data) }
                    case let .data(data):
                        self.handleServerMessage(data)
                    @unknown default:
                        break
                    }
                    guard self.webSocketTask === task, self.receiveGeneration == generation else { return }
                    self.receiveURLSessionLoop(for: service, task: task)
                }
            }
        }
    }

    private func receiveNetworkLoop(on connection: NWConnection) {
        connection.receiveMessage { [weak self] content, _, _, error in
            Task { @MainActor in
                guard let self, self.connection === connection else { return }
                if let error {
                    self.errorMessage = error.localizedDescription
                    self.isConnecting = false
                    self.isConnected = false
                    return
                }
                if let content { self.handleServerMessage(content) }
                guard self.connection === connection else { return }
                self.receiveNetworkLoop(on: connection)
            }
        }
    }

    private func handleServerMessage(_ data: Data) {
        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String
        else { return }

        if type == "hello-accepted", let service = pendingService {
            if let token = object["deviceToken"] as? String, !token.isEmpty {
                CredentialStore.setToken(token, for: credentialKey(for: service))
            }
            connectedService = service
            isConnected = true
            isConnecting = false
            errorMessage = nil
            enteredPairingCode = ""
            helloAttempts = 99 // stop further hello retries
        } else if type == "pairing-required" {
            let serverMessage = object["message"] as? String ?? "Pairing code was rejected"
            if enteredPairingCode.count == 6 {
                errorMessage = "\(serverMessage) (sent code \(enteredPairingCode)). Restart Desktop, then Forget paired devices, and try the new code."
            } else if enteredPairingCode.isEmpty {
                errorMessage = "\(serverMessage) — type the 6-digit code before Connect."
            } else {
                errorMessage = "\(serverMessage) (code length \(enteredPairingCode.count), need 6)."
            }
            if let service = pendingService {
                CredentialStore.removeToken(for: credentialKey(for: service))
            }
            isConnected = false
            isConnecting = false
            connectedService = nil
            tearDownTransport()
        }
    }

    private func credentialKey(for service: DesktopService) -> String {
        let encoded = Data(service.credentialAccount.utf8).base64EncodedString()
        return "lumastage.desktop-token.\(encoded)"
    }
}