// Reads actual movie metadata. Nominal FPS is not a frame-pacing measurement.
import Foundation
import AVFoundation

let asset = AVURLAsset(url: URL(fileURLWithPath: CommandLine.arguments[1]))
let duration = try await asset.load(.duration)
let tracks = try await asset.loadTracks(withMediaType: .video)
guard let track = tracks.first else { fatalError("Recording has no video track") }
let rate = try await track.load(.nominalFrameRate)
let size = try await track.load(.naturalSize)
let result: [String: Any] = ["durationMs": Int((duration.seconds * 1000).rounded()), "nominalFrameRate": Double(rate), "width": Int(size.width), "height": Int(size.height), "method": "AVFoundation movie metadata; nominal FPS is not measured animation smoothness"]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
