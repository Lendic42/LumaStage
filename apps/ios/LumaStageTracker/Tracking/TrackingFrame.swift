import Foundation

struct TrackingFrame: Equatable, Sendable {
    let sequence: UInt64
    let capturedAt: UInt64
    let faceFound: Bool
    let pitch: Double
    let yaw: Double
    let roll: Double
    let positionX: Double
    let positionY: Double
    let positionZ: Double
    let gazeX: Double
    let gazeY: Double
    let blendShapes: [String: Double]

    var jsonData: Data? {
        try? JSONSerialization.data(withJSONObject: [
            "type": "tracking",
            "protocol": 1,
            "sequence": sequence,
            "capturedAt": capturedAt,
            "faceFound": faceFound,
            "head": [
                "pitch": pitch, "yaw": yaw, "roll": roll,
                "positionX": positionX, "positionY": positionY, "positionZ": positionZ
            ],
            "gaze": ["x": gazeX, "y": gazeY],
            "blendShapes": blendShapes
        ])
    }
}

