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

    private var browser: NWBrowser?
    private var connection: NWConnection?

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

    func connect(to service: DesktopService) {
        connection?.cancel()

        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        parameters.includePeerToPeer = true

        let connection = NWConnection(to: service.endpoint, using: parameters)
        connection.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.connectedService = service
                    self.isConnected = true
                    self.sendHello()
                    self.receiveLoop()
                case .failed, .cancelled:
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
    }

    private func sendHello() {
        let payload: [String: Any] = [
            "type": "hello",
            "protocol": 1,
            "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString,
            "deviceName": UIDevice.current.name,
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload) { send(data) }
    }

    private func send(_ data: Data) {
        let context = NWConnection.ContentContext(identifier: "lumalink", metadata: [NWProtocolWebSocket.Metadata(opcode: .text)])
        connection?.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func receiveLoop() {
        connection?.receiveMessage { [weak self] _, _, _, error in
            Task { @MainActor in
                guard let self, error == nil, self.isConnected else { return }
                self.receiveLoop()
            }
        }
    }
}

