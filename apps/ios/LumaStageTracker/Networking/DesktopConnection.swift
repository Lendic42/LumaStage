import Foundation
import Network
import UIKit

struct DesktopService: Identifiable, Equatable {
    let endpoint: NWEndpoint
    var id: String { String(describing: endpoint) }
    var name: String {
        guard case let .service(name, _, _, _) = endpoint else { return "LumaStage Desktop" }
        return name
    }
    var subtitle: String { "Local network · LumaLink v1" }

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}

@MainActor
final class DesktopConnection: ObservableObject {
    @Published private(set) var services: [DesktopService] = []
    @Published private(set) var connectedService: DesktopService?
    @Published private(set) var isConnected = false
    @Published private(set) var errorMessage: String?

    private var browser: NWBrowser?
    private var connection: NWConnection?
    private var pendingService: DesktopService?
    private var enteredPairingCode = ""

    func startBrowsing() {
        guard browser == nil else { return }
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: "_lumastage._tcp", domain: nil), using: parameters)
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.map { DesktopService(endpoint: $0.endpoint) }.sorted { $0.name < $1.name }
            Task { @MainActor in self?.services = found }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func connect(to service: DesktopService, pairingCode: String) {
        connection?.cancel()
        errorMessage = nil
        isConnected = false
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
                    self.errorMessage = error.localizedDescription
                    self.isConnected = false
                    self.connectedService = nil
                case .cancelled:
                    self.isConnected = false
                    self.connectedService = nil
                default: break
                }
            }
        }
        connection.start(queue: .main)
        self.connection = connection
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
        connectedService = nil
        pendingService = nil
    }

    func hasStoredCredential(for service: DesktopService) -> Bool {
        CredentialStore.token(for: credentialKey(for: service)) != nil
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
                guard let self, error == nil else { return }
                guard self.connection === connection else { return }
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
            errorMessage = nil
            enteredPairingCode = ""
        } else if type == "pairing-required" {
            errorMessage = object["message"] as? String ?? "Pairing code was rejected"
            if let service = pendingService {
                CredentialStore.removeToken(for: credentialKey(for: service))
            }
            isConnected = false
            connectedService = nil
            connection?.cancel()
            connection = nil
        }
    }

    private func credentialKey(for service: DesktopService) -> String {
        let encoded = Data(service.name.utf8).base64EncodedString()
        return "lumastage.desktop-token.\(encoded)"
    }
}
