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
    private var pendingService: DesktopService?
    private var enteredPairingCode = ""

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
        connection?.cancel()
        connection = nil
        isConnected = false
        isConnecting = false
        connectedService = nil
        pendingService = nil
    }

    func hasStoredCredential(for service: DesktopService) -> Bool {
        CredentialStore.token(for: credentialKey(for: service)) != nil
    }

    private func openConnection(to service: DesktopService, pairingCode: String) {
        connection?.cancel()
        errorMessage = nil
        isConnected = false
        isConnecting = true
        pendingService = service
        enteredPairingCode = pairingCode.trimmingCharacters(in: .whitespacesAndNewlines)

        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        parameters.includePeerToPeer = true

        let connection = NWConnection(to: service.endpoint, using: parameters)
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                guard self.connection === connection else { return }
                switch state {
                case .ready:
                    self.sendHello(for: service)
                    self.receiveLoop(on: connection)
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
                return "Unreachable. Same Wi‑Fi/Ethernet/USB network? Use the PC IP from Desktop → Connect Tracker."
            }
        }
        return error.localizedDescription
    }

    private func sendHello(for service: DesktopService) {
        let storedToken = CredentialStore.token(for: credentialKey(for: service))
        let token = storedToken ?? enteredPairingCode
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
        let context = NWConnection.ContentContext(identifier: "lumalink", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection?.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func receiveLoop(on connection: NWConnection) {
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
                self.receiveLoop(on: connection)
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
            connection?.cancel()
            connection = nil
        }
    }

    private func credentialKey(for service: DesktopService) -> String {
        let encoded = Data(service.credentialAccount.utf8).base64EncodedString()
        return "lumastage.desktop-token.\(encoded)"
    }
}
