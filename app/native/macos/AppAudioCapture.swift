import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import Darwin

@available(macOS 13.0, *)
final class AppAudioWriter: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var started = false
    private let queue = DispatchQueue(label: "PulseStudio.AppAudioWriter")

    init(outputURL: URL) throws {
        try? FileManager.default.removeItem(at: outputURL)
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 192_000
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw NSError(domain: "PulseStudio.AppAudio", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not configure the application-audio writer."])
        }
        writer.add(input)
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .audio, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        queue.async { [weak self] in
            guard let self = self else { return }
            if !self.started {
                guard self.writer.startWriting() else { return }
                self.writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
                self.started = true
            }
            if self.input.isReadyForMoreMediaData {
                _ = self.input.append(sampleBuffer)
            }
        }
    }

    func finish(completion: @escaping () -> Void) {
        queue.async { [weak self] in
            guard let self = self else { completion(); return }
            self.input.markAsFinished()
            if self.started {
                self.writer.finishWriting(completionHandler: completion)
            } else {
                self.writer.cancelWriting()
                completion()
            }
        }
    }
}

@available(macOS 13.0, *)
func main() async throws {
    let args = CommandLine.arguments
    guard args.count >= 3 else {
        fputs("Usage: AppAudioCapture <window-title> <output.m4a> [parent-pid]\n", stderr)
        exit(2)
    }
    let requestedTitle = args[1]
    let outputURL = URL(fileURLWithPath: args[2])
    let parentPid: Int32? = args.count >= 4 ? Int32(args[3]) : nil

    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    let exact = content.windows.first { ($0.title ?? "") == requestedTitle }
    let fuzzy = content.windows.first {
        let title = $0.title ?? ""
        return !requestedTitle.isEmpty && (title.localizedCaseInsensitiveContains(requestedTitle) || requestedTitle.localizedCaseInsensitiveContains(title))
    }
    guard let window = exact ?? fuzzy else {
        throw NSError(domain: "PulseStudio.AppAudio", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not match the selected window in ScreenCaptureKit: \(requestedTitle)"])
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let config = SCStreamConfiguration()
    config.capturesAudio = true
    config.sampleRate = 48_000
    config.channelCount = 2
    config.excludesCurrentProcessAudio = true
    config.width = 2
    config.height = 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

    let writer = try AppAudioWriter(outputURL: outputURL)
    let stream = SCStream(filter: filter, configuration: config, delegate: writer)
    try stream.addStreamOutput(writer, type: .audio, sampleHandlerQueue: DispatchQueue(label: "PulseStudio.AppAudioSamples"))
    try await stream.startCapture()

    let stopSemaphore = DispatchSemaphore(value: 0)
    let signalQueue = DispatchQueue(label: "PulseStudio.AppAudioSignals")
    signal(SIGTERM, SIG_IGN)
    signal(SIGINT, SIG_IGN)
    let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: signalQueue)
    let intr = DispatchSource.makeSignalSource(signal: SIGINT, queue: signalQueue)
    term.setEventHandler { stopSemaphore.signal() }
    intr.setEventHandler { stopSemaphore.signal() }
    term.resume()
    intr.resume()
    var parentTimer: DispatchSourceTimer? = nil
    if let pid = parentPid, pid > 1 {
        let timer = DispatchSource.makeTimerSource(queue: signalQueue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler {
            if Darwin.kill(pid, 0) != 0 { stopSemaphore.signal() }
        }
        timer.resume()
        parentTimer = timer
    }

    print("READY")
    fflush(stdout)
    stopSemaphore.wait()
    parentTimer?.cancel()
    try? await stream.stopCapture()

    let done = DispatchSemaphore(value: 0)
    writer.finish { done.signal() }
    _ = done.wait(timeout: .now() + 10)
    print("DONE")
    fflush(stdout)
}

if #available(macOS 13.0, *) {
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        do {
            try await main()
        } catch {
            fputs("ERROR: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
        semaphore.signal()
    }
    semaphore.wait()
} else {
    fputs("Application-only audio requires macOS 13 or later.\n", stderr)
    exit(4)
}
