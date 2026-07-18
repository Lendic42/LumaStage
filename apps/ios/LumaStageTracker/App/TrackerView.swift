import Network
import SwiftUI

struct TrackerView: View {
    @EnvironmentObject private var network: DesktopConnection
    @EnvironmentObject private var tracker: FaceTrackingController
    @State private var pairingCode = ""
    @State private var manualHost = ""
    @State private var manualPort = String(DesktopConnection.defaultPort)
    @State private var showManual = true

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.04, green: 0.05, blue: 0.10), Color(red: 0.12, green: 0.09, blue: 0.22)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    header
                    cameraCard
                    connectionCard
                    signalsCard
                    privacyNote
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 30)
            }
        }
        .task {
            manualHost = network.lastManualHost
            manualPort = network.lastManualPort
            network.startBrowsing()
            tracker.start()
        }
        .onDisappear {
            tracker.stop()
            network.stop()
        }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text("LUMASTAGE").font(.caption2.weight(.bold)).tracking(2.2).foregroundStyle(.secondary)
                Text("Face Tracker").font(.title.bold())
            }
            Spacer()
            Circle().fill(network.isConnected ? Color.mint : Color.gray)
                .frame(width: 10, height: 10)
                .shadow(color: network.isConnected ? .mint : .clear, radius: 8)
        }
        .padding(.top, 14)
    }

    private var cameraCard: some View {
        ZStack(alignment: .bottomLeading) {
            FaceCameraView(session: tracker.session)
                .frame(height: 360)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 28).stroke(.white.opacity(0.10)))
            LinearGradient(colors: [.clear, .black.opacity(0.74)], startPoint: .center, endPoint: .bottom)
                .clipShape(RoundedRectangle(cornerRadius: 28))
            HStack(spacing: 8) {
                Circle().fill(tracker.faceFound ? Color.mint : Color.orange).frame(width: 8, height: 8)
                Text(tracker.faceFound ? "Face locked" : "Looking for a face")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(18)
        }
    }

    private var connectionCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            Label("Desktop connection", systemImage: "desktopcomputer")
                .font(.headline)

            if network.isConnected, let service = network.connectedService {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(service.name).font(.subheadline.weight(.semibold))
                        Text("Connected · \(service.subtitle)").font(.caption).foregroundStyle(.mint)
                    }
                    Spacer()
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(.mint)
                }
                .padding(13)
                .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
            }

            TextField("6-digit code from desktop", text: $pairingCode)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .padding(12)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

            if network.services.isEmpty {
                HStack {
                    if !network.isConnected {
                        ProgressView()
                    }
                    Text(network.isConnected ? "Also scanning for other desktops…" : "Searching on local network…")
                        .foregroundStyle(.secondary)
                        .font(.subheadline)
                }
            } else {
                ForEach(network.services) { service in
                    Button {
                        network.connect(to: service, pairingCode: pairingCode)
                    } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(service.name).font(.subheadline.weight(.semibold))
                                Text(service.subtitle).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: network.connectedService?.id == service.id ? "checkmark.circle.fill" : "chevron.right")
                                .foregroundStyle(network.connectedService?.id == service.id ? .mint : .secondary)
                        }
                        .padding(13)
                        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .disabled(network.isConnecting || (pairingCode.count != 6 && !network.hasStoredCredential(for: service)))
                }
            }

            DisclosureGroup(isExpanded: $showManual) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Use when Bonjour fails (especially Windows) or for USB Personal Hotspot.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    TextField("Desktop IP (e.g. 192.168.1.42)", text: $manualHost)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.numbersAndPunctuation)
                        .padding(12)
                        .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))

                    HStack(spacing: 10) {
                        TextField("Port", text: $manualPort)
                            .keyboardType(.numberPad)
                            .padding(12)
                            .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                            .frame(maxWidth: 110)

                        Button {
                            network.connect(host: manualHost, port: manualPort, pairingCode: pairingCode)
                        } label: {
                            HStack {
                                if network.isConnecting {
                                    ProgressView().controlSize(.small)
                                }
                                Text(network.isConnecting ? "Connecting…" : "Connect")
                                    .font(.subheadline.weight(.semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(12)
                            .background(canManualConnect ? Color.indigo : Color.gray.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
                            .foregroundStyle(.white)
                        }
                        .buttonStyle(.plain)
                        .disabled(!canManualConnect || network.isConnecting)
                    }

                    Text("Wi‑Fi / Ethernet: same network as PC. USB: enable Personal Hotspot over cable, then enter the PC IP shown in Desktop.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 6)
            } label: {
                Text("Manual IP & port")
                    .font(.subheadline.weight(.semibold))
            }
            .tint(.secondary)

            if let message = network.errorMessage {
                Text(message).font(.caption).foregroundStyle(.red)
            }
        }
        .cardStyle()
    }

    private var canManualConnect: Bool {
        let hostOk = !manualHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let portOk = UInt16(manualPort.trimmingCharacters(in: .whitespacesAndNewlines)) != nil
        let codeOk = pairingCode.count == 6
        // Allow without code if we might have a stored token for this host (checked on connect)
        // Still require 6 digits for first-time manual connect UX; stored tokens work when code empty if previously paired
        if hostOk && portOk {
            let host = manualHost.trimmingCharacters(in: .whitespacesAndNewlines)
            let port = manualPort.trimmingCharacters(in: .whitespacesAndNewlines)
            if let portValue = UInt16(port),
               let nwPort = NWEndpoint.Port(rawValue: portValue) {
                let endpoint = NWEndpoint.hostPort(host: NWEndpoint.Host(host), port: nwPort)
                let service = DesktopService(endpoint: endpoint, displayName: "\(host):\(portValue)")
                if network.hasStoredCredential(for: service) { return true }
            }
            return codeOk
        }
        return false
    }

    private var signalsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Label("Live signals", systemImage: "waveform.path.ecg").font(.headline); Spacer(); Text("30 FPS").font(.caption).foregroundStyle(.secondary) }
            SignalBar(label: "Mouth", value: tracker.signal("jawOpen"))
            SignalBar(label: "Blink L", value: tracker.signal("eyeBlinkLeft"))
            SignalBar(label: "Blink R", value: tracker.signal("eyeBlinkRight"))
            SignalBar(label: "Smile", value: (tracker.signal("mouthSmileLeft") + tracker.signal("mouthSmileRight")) / 2)
        }
        .cardStyle()
    }

    private var privacyNote: some View {
        Label("Only numeric expression data is sent. Camera images stay on this iPhone.", systemImage: "lock.shield.fill")
            .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 8)
    }
}

private struct SignalBar: View {
    let label: String
    let value: Double

    var body: some View {
        HStack {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 52, alignment: .leading)
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.08))
                    Capsule().fill(LinearGradient(colors: [.indigo, .pink], startPoint: .leading, endPoint: .trailing))
                        .frame(width: proxy.size.width * max(0, min(1, value)))
                }
            }
            .frame(height: 6)
            Text(value.formatted(.number.precision(.fractionLength(2)))).font(.caption2.monospacedDigit()).foregroundStyle(.secondary).frame(width: 30)
        }
    }
}

private extension View {
    func cardStyle() -> some View {
        self.padding(18)
            .background(.ultraThinMaterial.opacity(0.65), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(.white.opacity(0.08)))
    }
}
