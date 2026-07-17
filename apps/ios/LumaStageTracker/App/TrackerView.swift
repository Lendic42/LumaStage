import SwiftUI

struct TrackerView: View {
    @EnvironmentObject private var network: DesktopConnection
    @EnvironmentObject private var tracker: FaceTrackingController
    @State private var pairingCode = ""

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
            if network.services.isEmpty {
                HStack { ProgressView(); Text("Searching on local network…").foregroundStyle(.secondary) }
            } else {
                TextField("6-digit code from desktop", text: $pairingCode)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .padding(12)
                    .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
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
                    .disabled(pairingCode.count != 6 && !network.hasStoredCredential(for: service))
                }
                if let message = network.errorMessage {
                    Text(message).font(.caption).foregroundStyle(.red)
                }
            }
        }
        .cardStyle()
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
