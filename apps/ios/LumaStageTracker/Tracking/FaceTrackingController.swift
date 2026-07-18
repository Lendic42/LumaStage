import ARKit
import Foundation
import simd

@MainActor
final class FaceTrackingController: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    @Published private(set) var latestFrame: TrackingFrame?
    @Published private(set) var faceFound = false
    @Published private(set) var blendShapes: [String: Double] = [:]

    private var sequence: UInt64 = 0
    private var lastSentAt: TimeInterval = 0

    override init() {
        super.init()
        session.delegate = self
    }

    func start() {
        guard ARFaceTrackingConfiguration.isSupported else { return }
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = true
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
    }

    func signal(_ name: String) -> Double {
        blendShapes[name] ?? 0
    }

    nonisolated func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let anchor = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        let timestamp = Date().timeIntervalSince1970
        Task { @MainActor in
            guard timestamp - self.lastSentAt >= (1.0 / 30.0) else { return }
            self.lastSentAt = timestamp
            self.consume(anchor, at: timestamp)
        }
    }

    nonisolated func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        guard anchors.contains(where: { $0 is ARFaceAnchor }) else { return }
        Task { @MainActor in self.faceFound = false }
    }

    private func consume(_ anchor: ARFaceAnchor, at timestamp: TimeInterval) {
        let transform = anchor.transform
        let euler = eulerAngles(from: transform)
        let position = transform.columns.3
        var shapes = Dictionary(uniqueKeysWithValues: anchor.blendShapes.map { key, value in
            (key.rawValue, min(1, max(0, value.doubleValue)))
        })
        let canonicalShapes: [(String, ARFaceAnchor.BlendShapeLocation)] = [
            ("eyeBlinkLeft", .eyeBlinkLeft), ("eyeBlinkRight", .eyeBlinkRight),
            ("eyeWideLeft", .eyeWideLeft), ("eyeWideRight", .eyeWideRight),
            ("eyeLookInLeft", .eyeLookInLeft), ("eyeLookOutLeft", .eyeLookOutLeft),
            ("eyeLookUpLeft", .eyeLookUpLeft), ("eyeLookDownLeft", .eyeLookDownLeft),
            ("eyeLookInRight", .eyeLookInRight), ("eyeLookOutRight", .eyeLookOutRight),
            ("eyeLookUpRight", .eyeLookUpRight), ("eyeLookDownRight", .eyeLookDownRight),
            ("mouthSmileLeft", .mouthSmileLeft), ("mouthSmileRight", .mouthSmileRight),
            ("mouthFrownLeft", .mouthFrownLeft), ("mouthFrownRight", .mouthFrownRight),
            ("jawOpen", .jawOpen), ("mouthFunnel", .mouthFunnel),
            ("mouthLeft", .mouthLeft), ("mouthRight", .mouthRight),
            ("browInnerUp", .browInnerUp), ("browOuterUpLeft", .browOuterUpLeft),
            ("browOuterUpRight", .browOuterUpRight), ("browDownLeft", .browDownLeft),
            ("browDownRight", .browDownRight), ("cheekPuff", .cheekPuff),
            ("tongueOut", .tongueOut)
        ]
        for (name, location) in canonicalShapes {
            shapes[name] = min(1, max(0, anchor.blendShapes[location]?.doubleValue ?? 0))
        }
        let look = anchor.lookAtPoint
        let eyeLookX = ((shapes["eyeLookInLeft"] ?? 0) + (shapes["eyeLookOutRight"] ?? 0)
            - (shapes["eyeLookOutLeft"] ?? 0) - (shapes["eyeLookInRight"] ?? 0)) / 2
        let eyeLookY = ((shapes["eyeLookUpLeft"] ?? 0) + (shapes["eyeLookUpRight"] ?? 0)
            - (shapes["eyeLookDownLeft"] ?? 0) - (shapes["eyeLookDownRight"] ?? 0)) / 2
        let directionalGazeAvailable = abs(eyeLookX) + abs(eyeLookY) > 0.015
        let gazeX = directionalGazeAvailable ? eyeLookX * 1.8 : Double(look.x) / 0.15
        let gazeY = directionalGazeAvailable ? eyeLookY * 1.8 : Double(look.y) / 0.15

        sequence += 1
        faceFound = anchor.isTracked
        blendShapes = shapes
        latestFrame = TrackingFrame(
            sequence: sequence,
            capturedAt: UInt64(timestamp * 1_000),
            faceFound: anchor.isTracked,
            pitch: euler.x,
            yaw: euler.y,
            roll: euler.z,
            positionX: Double(position.x),
            positionY: Double(position.y),
            positionZ: Double(position.z),
            gazeX: min(1, max(-1, gazeX)),
            gazeY: min(1, max(-1, gazeY)),
            blendShapes: shapes
        )
    }

    private func eulerAngles(from matrix: simd_float4x4) -> SIMD3<Double> {
        let pitch = asin(-Double(matrix.columns.2.y))
        let yaw = atan2(Double(matrix.columns.2.x), Double(matrix.columns.2.z))
        let roll = atan2(Double(matrix.columns.0.y), Double(matrix.columns.1.y))
        return SIMD3(pitch, yaw, roll)
    }
}
