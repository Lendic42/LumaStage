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
            return "host:\(host):\(port)"
        default:
            return id
        }
    }

    /// Manual IPv4/hostname endpoint — prefer URLSession WebSocket for reliability on Windows LANs.
    var manualHostPort: (host: String, port: UInt16)? {
        guard case let .hostPort(host, port) = endpoint else { return nil }
        return (String(describing: host), port.rawValue)
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
    }

    private func openConnection(to service: DesktopService, pairingCode: String) {
        tearDownTransport()
        errorMessage = nil
        isConnected = false
        isConnecting = true
        pendingService = service
        enteredPairingCode = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)

        // Manual host:port — URLSession WebSocket is more reliable to Windows desktops than NWProtocolWebSocket.
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

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: url)
        urlSession = session
        webSocketTask = task
        task.resume()
        // URLSession does not expose a ready callback; send hello immediately and start receive.
        // Failed handshakes surface on the first send/receive error.
        sendHello(for: service)
        receiveURLSessionLoop(for: service, task: task)
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
                return "Unreachable. Same Wi‑Fi/Ethernet/USB network? Use the first (LAN) IP from Desktop → Connect Tracker — not VPN/Tailscale unless both sides use it."
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
        // If the user typed a pairing code, always prefer it so a stale device token cannot block re-pair.
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
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        ]
        if !token.isEmpty { payload["token"] = token }
        if let data = try? JSONSerialization.data(withJSONObject: payload) { send(data) }
    }

    private func send(_ data: Data) {
        if let task = webSocketTask {
            guard let text = String(data: data, encoding: .utf8) else { return }
            task.send(.string(text)) { [weak self] error in
                Task { @MainActor in
                    guard let self else { return }
                    if let error {
                        self.errorMessage = self.friendlyURLError(error)
                        self.isConnecting = false
                        self.isConnected = false
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
                    self.errorMessage = self.friendlyURLError(error)
                    self.isConnecting = false
                    self.isConnected = false
                    self.connectedService = nil
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
        } else if type == "pairing-required" {
            errorMessage = object["message"] as? String ?? "Pairing code was rejected"
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
