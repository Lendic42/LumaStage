import SwiftUI

@main
struct LumaStageTrackerApp: App {
    @StateObject private var network = DesktopConnection()
    @StateObject private var tracker = FaceTrackingController()

    var body: some Scene {
        WindowGroup {
            TrackerView()
                .environmentObject(network)
                .environmentObject(tracker)
                .preferredColorScheme(.dark)
                .onChange(of: tracker.latestFrame) { _, frame in
                    guard let frame else { return }
                    network.send(frame)
                }
        }
    }
}

