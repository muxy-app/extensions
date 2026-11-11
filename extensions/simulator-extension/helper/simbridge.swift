// simbridge streams an iOS Simulator's screen to the Muxy panel and sends the
// simulator touches, hardware buttons, and keys. It speaks WebSocket on
// 127.0.0.1 and only accepts connections from Muxy extension pages.
//
// The panel compiles this file on first use (into ~/Library/Caches) and starts
// it in the background. It exits on its own when no panel is connected.
//
// It loads Xcode's private CoreSimulator and SimulatorKit frameworks at
// runtime, the same ones Simulator.app uses, so no Simulator window is needed.

import AppKit
import CoreImage
import Foundation
import IOSurface
import Network
import ObjectiveC

// MARK: - Options

struct Options {
    var port: UInt16 = 47290
    var version = "dev"
    var idleExit: TimeInterval = 30
}

let options: Options = {
    var o = Options()
    var args = CommandLine.arguments.dropFirst().makeIterator()
    while let arg = args.next() {
        switch arg {
        case "--port": if let v = args.next(), let p = UInt16(v) { o.port = p }
        case "--version": if let v = args.next() { o.version = v }
        case "--idle-exit": if let v = args.next(), let t = TimeInterval(v) { o.idleExit = t }
        default: break
        }
    }
    return o
}()

func uptime() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }

func log(_ message: String) {
    FileHandle.standardError.write(Data("\(Date()) \(message)\n".utf8))
}

struct BridgeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

// MARK: - Running tools

struct ToolResult {
    let status: Int32
    let stdout: Data
    let stderr: String
    var text: String { String(decoding: stdout, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) }
    var errorMessage: String { stderr.isEmpty ? "exit code \(status)" : stderr }
}

func runTool(_ path: String, _ args: [String], stdin: Data? = nil) -> ToolResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = args
    let out = Pipe(), err = Pipe(), input = Pipe()
    process.standardOutput = out
    process.standardError = err
    process.standardInput = stdin == nil ? FileHandle.nullDevice : input
    do { try process.run() } catch { return ToolResult(status: -1, stdout: Data(), stderr: "\(error)") }
    if let stdin {
        input.fileHandleForWriting.write(stdin)
        try? input.fileHandleForWriting.close()
    }
    var errData = Data()
    let group = DispatchGroup()
    group.enter()
    DispatchQueue.global().async {
        errData = err.fileHandleForReading.readDataToEndOfFile()
        group.leave()
    }
    let outData = out.fileHandleForReading.readDataToEndOfFile()
    group.wait()
    process.waitUntilExit()
    let errText = String(decoding: errData, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return ToolResult(status: process.terminationStatus, stdout: outData, stderr: errText)
}

func simctl(_ args: [String], stdin: Data? = nil) -> ToolResult {
    runTool("/usr/bin/xcrun", ["simctl"] + args, stdin: stdin)
}

// MARK: - Objective-C messaging
//
// Most simulator objects are proxies for objects in CoreSimulatorService, so
// key-value coding doesn't work on them. Messages go through objc_msgSend.

private let objcMsgSend = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "objc_msgSend")!

enum ObjC {
    static func sel(_ name: String) -> Selector { NSSelectorFromString(name) }

    static func object(_ target: AnyObject, _ selector: String) -> AnyObject? {
        typealias Fn = @convention(c) (AnyObject, Selector) -> Unmanaged<AnyObject>?
        return unsafeBitCast(objcMsgSend, to: Fn.self)(target, sel(selector))?.takeUnretainedValue()
    }

    static func uint16(_ target: AnyObject, _ selector: String) -> UInt16 {
        typealias Fn = @convention(c) (AnyObject, Selector) -> UInt16
        return unsafeBitCast(objcMsgSend, to: Fn.self)(target, sel(selector))
    }

    static func object(_ target: AnyObject, _ selector: String, error: inout NSError?) -> AnyObject? {
        typealias Fn = @convention(c) (AnyObject, Selector, AutoreleasingUnsafeMutablePointer<NSError?>?) -> Unmanaged<AnyObject>?
        return unsafeBitCast(objcMsgSend, to: Fn.self)(target, sel(selector), &error)?.takeUnretainedValue()
    }

    static func object(_ target: AnyObject, _ selector: String, _ arg: AnyObject, error: inout NSError?) -> AnyObject? {
        typealias Fn = @convention(c) (AnyObject, Selector, AnyObject, AutoreleasingUnsafeMutablePointer<NSError?>?) -> Unmanaged<AnyObject>?
        return unsafeBitCast(objcMsgSend, to: Fn.self)(target, sel(selector), arg, &error)?.takeUnretainedValue()
    }

    /// `[[cls alloc] initWith…:arg error:]`, which returns a retained object.
    static func create(_ cls: AnyClass, _ initSelector: String, _ arg: AnyObject, error: inout NSError?) -> AnyObject? {
        typealias Alloc = @convention(c) (AnyObject, Selector) -> Unmanaged<AnyObject>?
        typealias Init = @convention(c) (AnyObject, Selector, AnyObject, AutoreleasingUnsafeMutablePointer<NSError?>?) -> Unmanaged<AnyObject>?
        guard let allocated = unsafeBitCast(objcMsgSend, to: Alloc.self)(cls, sel("alloc")) else { return nil }
        // init consumes the allocated object, so it is passed unretained.
        return unsafeBitCast(objcMsgSend, to: Init.self)(allocated.takeUnretainedValue(), sel(initSelector), arg, &error)?
            .takeRetainedValue()
    }

    static func responds(_ target: AnyObject, _ selector: String) -> Bool {
        (target as? NSObject)?.responds(to: sel(selector)) ?? false
    }
}

// MARK: - Simulator frameworks

typealias MouseMessageFn = @convention(c) (
    UnsafePointer<CGPoint>, UnsafePointer<CGPoint>?, UInt32, UInt, CGSize, UInt32
) -> UnsafeMutableRawPointer?
typealias ButtonMessageFn = @convention(c) (UInt32, UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias KeyMessageFn = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias HIDSendFn = @convention(c) (
    AnyObject, Selector, UnsafeMutableRawPointer, Bool, DispatchQueue?, (@convention(block) (NSError?) -> Void)?
) -> Void

enum HID {
    static let touchTarget: UInt32 = 0x32
    static let buttonTarget: UInt32 = 0x33
    static let down: UInt32 = 1
    static let up: UInt32 = 2
    // NSEventType values the touch message builder understands.
    static let mouseDown: UInt = 1
    static let mouseUp: UInt = 2
    static let mouseDragged: UInt = 6
    // IndigoHIDEdge value for a touch that starts on the bottom edge (home gesture).
    static let bottomEdge: UInt32 = 3
    // Hardware button event sources.
    static let homeButton: UInt32 = 0x0
    static let lockButton: UInt32 = 0x1
}

final class SimKit {
    static let shared: Result<SimKit, Error> = Result { try SimKit() }

    let developerDir: String
    let mouseMessage: MouseMessageFn
    let buttonMessage: ButtonMessageFn
    let keyMessage: KeyMessageFn
    private let hidClientClass: AnyClass
    private let deviceSet: AnyObject
    private let hidQueue = DispatchQueue(label: "simbridge.hid")

    private init() throws {
        let dir = developerDirectory()
        guard !dir.isEmpty else { throw BridgeError("Xcode isn't installed or selected (xcode-select -p is empty).") }
        developerDir = dir

        let coreSimulatorPaths = [
            "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
            dir + "/Library/PrivateFrameworks/CoreSimulator.framework/CoreSimulator",
        ]
        guard coreSimulatorPaths.contains(where: { dlopen($0, RTLD_NOW) != nil }) else {
            throw BridgeError("CoreSimulator.framework wasn't found. Is Xcode installed?")
        }
        let contents = (dir as NSString).deletingLastPathComponent
        let simulatorKitPaths = [
            contents + "/SharedFrameworks/SimulatorKit.framework/SimulatorKit",
            dir + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit",
        ]
        guard let kit = simulatorKitPaths.lazy.compactMap({ dlopen($0, RTLD_NOW) }).first else {
            throw BridgeError("SimulatorKit.framework wasn't found in \(contents).")
        }
        func symbol<T>(_ name: String, _ type: T.Type) throws -> T {
            guard let pointer = dlsym(kit, name) else { throw BridgeError("This Xcode has no \(name).") }
            return unsafeBitCast(pointer, to: type)
        }
        mouseMessage = try symbol("IndigoHIDMessageForMouseNSEvent", MouseMessageFn.self)
        buttonMessage = try symbol("IndigoHIDMessageForButton", ButtonMessageFn.self)
        keyMessage = try symbol("IndigoHIDMessageForKeyboardArbitrary", KeyMessageFn.self)

        guard let hidClass = NSClassFromString("_TtC12SimulatorKit24SimDeviceLegacyHIDClient")
            ?? NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient")
        else { throw BridgeError("This Xcode has no SimDeviceLegacyHIDClient.") }
        hidClientClass = hidClass

        guard let contextClass = NSClassFromString("SimServiceContext") else {
            throw BridgeError("This Xcode has no SimServiceContext.")
        }
        var error: NSError?
        guard let context = ObjC.object(contextClass, "sharedServiceContextForDeveloperDir:error:", dir as NSString, error: &error),
              let set = ObjC.object(context, "defaultDeviceSetWithError:", error: &error)
        else { throw BridgeError("CoreSimulator didn't start: \(error?.localizedDescription ?? "unknown error")") }
        deviceSet = set
    }

    func device(_ udid: String) -> AnyObject? {
        guard let uuid = NSUUID(uuidString: udid),
              let devices = ObjC.object(deviceSet, "devicesByUDID") as? [NSUUID: AnyObject]
        else { return nil }
        return devices[uuid]
    }

    func makeHIDClient(_ device: AnyObject) throws -> AnyObject {
        var error: NSError?
        guard let client = ObjC.create(hidClientClass, "initWithDevice:error:", device, error: &error) else {
            throw BridgeError("Touch input is unavailable: \(error?.localizedDescription ?? "unknown error")")
        }
        return client
    }

    /// Sends a message built by one of the Indigo functions. The client frees it.
    func send(_ message: UnsafeMutableRawPointer?, to client: AnyObject) {
        guard let message else { return }
        let selector = ObjC.sel("sendWithMessage:freeWhenDone:completionQueue:completion:")
        guard let method = class_getInstanceMethod(object_getClass(client), selector) else { return }
        let send = unsafeBitCast(method_getImplementation(method), to: HIDSendFn.self)
        send(client, selector, message, true, hidQueue) { error in
            if let error { log("HID send failed: \(error.localizedDescription)") }
        }
    }
}

// MARK: - Images

enum Images {
    static let context = CIContext(options: [.cacheIntermediates: false])
    static let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

    static func jpeg(_ surface: IOSurfaceRef, maxWidth: Int, quality: Double) -> Data? {
        var image = CIImage(ioSurface: surface)
        let width = Double(IOSurfaceGetWidth(surface))
        let scale = min(1, Double(maxWidth) / width)
        if scale < 0.999 {
            image = image.applyingFilter("CILanczosScaleTransform", parameters: [
                kCIInputScaleKey: scale, kCIInputAspectRatioKey: 1.0,
            ])
        }
        let key = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
        return context.jpegRepresentation(of: image, colorSpace: srgb, options: [key: quality])
    }
}

// MARK: - Device commands

func runtimeName(_ identifier: String) -> String {
    // com.apple.CoreSimulator.SimRuntime.iOS-27-0 -> iOS 27.0
    let last = identifier.components(separatedBy: ".").last ?? identifier
    var parts = last.components(separatedBy: "-")
    guard !parts.isEmpty else { return last }
    var platform = parts.removeFirst()
    if platform == "xrOS" { platform = "visionOS" }
    return parts.isEmpty ? platform : "\(platform) \(parts.joined(separator: "."))"
}

func listDevices() throws -> [[String: Any]] {
    let result = simctl(["list", "devices", "available", "-j"])
    guard result.status == 0,
          let json = try? JSONSerialization.jsonObject(with: result.stdout) as? [String: Any],
          let runtimes = json["devices"] as? [String: [[String: Any]]]
    else { throw BridgeError("simctl list failed: \(result.errorMessage)") }
    var devices: [[String: Any]] = []
    for (runtime, list) in runtimes {
        for device in list {
            devices.append([
                "udid": device["udid"] ?? "",
                "name": device["name"] ?? "",
                "state": device["state"] ?? "",
                "runtime": runtimeName(runtime),
                "runtimeId": runtime,
                "deviceType": device["deviceTypeIdentifier"] ?? "",
            ])
        }
    }
    return devices
}

func requireUDID(_ message: [String: Any]) throws -> String {
    guard let udid = message["udid"] as? String, NSUUID(uuidString: udid) != nil else {
        throw BridgeError("No simulator selected.")
    }
    return udid
}

func checked(_ result: ToolResult) throws -> ToolResult {
    guard result.status == 0 else { throw BridgeError(result.errorMessage) }
    return result
}

func screenshotPath(deviceName: String) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
    let desktop = FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first
        ?? URL(fileURLWithPath: NSHomeDirectory())
    let safeName = deviceName.replacingOccurrences(of: "/", with: "-")
    let name = "Simulator Screenshot - \(safeName) - \(formatter.string(from: Date())).png"
    return desktop.appendingPathComponent(name).path
}

func developerDirectory() -> String {
    let fromEnvironment = ProcessInfo.processInfo.environment["DEVELOPER_DIR"] ?? ""
    return fromEnvironment.isEmpty ? runTool("/usr/bin/xcode-select", ["-p"]).text : fromEnvironment
}

/// Opens Xcode's simulator app: Simulator.app up to Xcode 26, DeviceHub.app from
/// Xcode 27. Only Simulator.app can be told which device to show.
func openSimulatorApp(udid: String) throws -> String {
    let developer = developerDirectory()
    let contents = (developer as NSString).deletingLastPathComponent
    let candidates: [(path: String, args: [String])] = [
        (developer + "/Applications/Simulator.app", ["--args", "-CurrentDeviceUDID", udid]),
        (contents + "/Applications/DeviceHub.app", []),
    ]
    for app in candidates where FileManager.default.fileExists(atPath: app.path) {
        _ = try checked(runTool("/usr/bin/open", ["-a", app.path] + app.args))
        return (app.path as NSString).lastPathComponent
    }
    // Not inside the selected Xcode: let Launch Services find either app by name.
    for name in ["Simulator", "DeviceHub"] where runTool("/usr/bin/open", ["-a", name]).status == 0 {
        return "\(name).app"
    }
    throw BridgeError("Neither Simulator.app nor DeviceHub.app was found in \(contents).")
}

/// Runs a request that doesn't need the session's device connection.
func perform(_ type: String, _ message: [String: Any]) throws -> Any {
    switch type {
    case "list":
        return try listDevices()
    case "boot":
        let udid = try requireUDID(message)
        let result = simctl(["boot", udid])
        if result.status != 0 && !result.stderr.contains("current state: Booted") {
            throw BridgeError(result.errorMessage)
        }
        return true
    case "shutdown":
        _ = try checked(simctl(["shutdown", try requireUDID(message)]))
        return true
    case "appearance":
        let udid = try requireUDID(message)
        var mode = message["mode"] as? String ?? "toggle"
        if mode == "toggle" {
            let current = try checked(simctl(["ui", udid, "appearance"])).text
            mode = current == "dark" ? "light" : "dark"
        }
        guard mode == "dark" || mode == "light" else { throw BridgeError("Unknown appearance \(mode).") }
        _ = try checked(simctl(["ui", udid, "appearance", mode]))
        return mode
    case "openurl":
        let udid = try requireUDID(message)
        guard let url = message["url"] as? String, !url.isEmpty else { throw BridgeError("Enter a URL.") }
        _ = try checked(simctl(["openurl", udid, url]))
        return true
    case "screenshot":
        let udid = try requireUDID(message)
        let path = screenshotPath(deviceName: message["name"] as? String ?? "Simulator")
        _ = try checked(simctl(["io", udid, "screenshot", "--type=png", path]))
        if let data = FileManager.default.contents(atPath: path) {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setData(data, forType: .png)
        }
        return path
    case "openSimulator":
        return try openSimulatorApp(udid: try requireUDID(message))
    default:
        throw BridgeError("Unknown request \(type).")
    }
}

// MARK: - Session

/// One connected panel. It streams one simulator's screen at a time.
final class Session {
    private static var nextID = 0

    let id: Int
    private let connection: NWConnection
    private let queue: DispatchQueue
    private let onClose: (Session) -> Void
    private var closed = false
    private var timer: DispatchSourceTimer?

    // The attached simulator.
    private var udid: String?
    private var device: AnyObject?
    private var display: AnyObject?
    private var surface: IOSurfaceRef?
    private var surfaceID: IOSurfaceID = 0
    private var hid: AnyObject?
    private var state = ""
    private var lastCheck: UInt64 = 0 // uptime nanoseconds; 0 checks on the next tick
    private var reportedDisplayProblem = false

    // Streaming.
    private var maxWidth = 800
    private var quality = 0.72
    private var paused = false
    private var awaitingAck = false
    private var sentAt: UInt64 = 0
    private var lastSeed: UInt32 = 0
    private var needsFrame = true

    // The touch in progress.
    private var touchEdge: UInt32 = 0

    init(connection: NWConnection, onClose: @escaping (Session) -> Void) {
        Session.nextID += 1
        id = Session.nextID
        self.connection = connection
        self.onClose = onClose
        queue = DispatchQueue(label: "simbridge.session.\(Session.nextID)")
    }

    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.send(["t": "hello", "version": options.version, "pid": Int(getpid())])
                self.receive()
                self.startTimer()
            case .failed, .cancelled:
                self.close()
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    private func close() {
        guard !closed else { return }
        closed = true
        timer?.cancel()
        timer = nil
        connection.cancel()
        onClose(self)
    }

    // MARK: Messages

    private func receive() {
        connection.receiveMessage { [weak self] data, context, _, error in
            guard let self, !self.closed else { return }
            if error != nil { return self.close() }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if metadata?.opcode == .close { return self.close() }
            if let data, metadata?.opcode == .text,
               let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                self.handle(message)
            }
            self.receive()
        }
    }

    private func send(_ message: [String: Any]) {
        guard !closed, let data = try? JSONSerialization.data(withJSONObject: message) else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
    }

    private func sendBinary(_ data: Data) {
        guard !closed else { return }
        let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
        let context = NWConnection.ContentContext(identifier: "frame", metadata: [metadata])
        connection.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
    }

    private func notice(_ text: String, level: String = "error") {
        send(["t": "notice", "level": level, "message": text])
    }

    private func handle(_ message: [String: Any]) {
        guard let type = message["t"] as? String else { return }
        switch type {
        case "ack":
            awaitingAck = false
        case "config":
            if let width = message["maxWidth"] as? Int, width > 0 { maxWidth = min(width, 4096) }
            if let q = message["quality"] as? Double { quality = min(max(q, 0.3), 0.95) }
            needsFrame = true
        case "pause":
            paused = true
        case "resume":
            paused = false
            needsFrame = true
        case "attach":
            attach(message["udid"] as? String)
        case "touch":
            touch(message)
        case "button":
            button(message["name"] as? String ?? "")
        case "key":
            key(message)
        case "paste":
            paste()
        case "quit":
            log("quit requested")
            exit(0)
        default:
            request(type, message)
        }
    }

    /// Runs a request off the session queue and replies with its result.
    private func request(_ type: String, _ message: [String: Any]) {
        let id = message["id"] ?? NSNull()
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var reply: [String: Any] = ["t": "reply", "id": id]
            do {
                reply["result"] = try perform(type, message)
                reply["ok"] = true
            } catch {
                reply["ok"] = false
                reply["error"] = "\(error)"
            }
            self?.queue.async {
                self?.send(reply)
                if type == "boot" || type == "shutdown" { self?.lastCheck = 0 }
            }
        }
    }

    // MARK: Device

    private func attach(_ newUDID: String?) {
        detachDisplay()
        device = nil
        state = ""
        udid = newUDID
        lastCheck = 0
        reportedDisplayProblem = false
    }

    private func detachDisplay() {
        display = nil
        surface = nil
        surfaceID = 0
        hid = nil
        awaitingAck = false
        lastSeed = 0
    }

    /// Follows the attached simulator's state, and connects to its display once it boots.
    private func checkDevice() {
        lastCheck = uptime()
        guard let udid else { return }
        let kit: SimKit
        switch SimKit.shared {
        case .success(let value): kit = value
        case .failure(let error):
            if !reportedDisplayProblem { notice("\(error)"); reportedDisplayProblem = true }
            return
        }
        if device == nil { device = kit.device(udid) }
        guard let device else {
            if state != "Missing" { state = "Missing"; send(["t": "state", "udid": udid, "state": state]) }
            return
        }
        let current = ObjC.object(device, "stateString") as? String ?? "Unknown"
        if current != state {
            state = current
            send(["t": "state", "udid": udid, "state": current])
            if current != "Booted" { detachDisplay() }
        }
        guard current == "Booted" else { return }
        if display == nil { connectDisplay(kit, device) }
        refreshSurface()
    }

    private func connectDisplay(_ kit: SimKit, _ device: AnyObject) {
        guard let io = ObjC.object(device, "io"),
              let ports = ObjC.object(io, "ioPorts") as? [AnyObject]
        else { return }
        for port in ports {
            guard let descriptor = ObjC.object(port, "descriptor"),
                  ObjC.responds(descriptor, "framebufferSurface"),
                  ObjC.responds(descriptor, "state"),
                  let displayState = ObjC.object(descriptor, "state"),
                  ObjC.uint16(displayState, "displayClass") == 0 // the built-in screen
            else { continue }
            display = descriptor
            break
        }
        guard display != nil else { return }
        do {
            hid = try kit.makeHIDClient(device)
        } catch {
            notice("\(error)", level: "warning")
        }
        log("session \(id): connected to \(udid ?? "?")")
    }

    private func refreshSurface() {
        guard let display, let object = ObjC.object(display, "framebufferSurface") else { return }
        let ref = unsafeBitCast(object, to: IOSurfaceRef.self)
        let id = IOSurfaceGetID(ref)
        guard id != surfaceID else { return }
        surface = ref
        surfaceID = id
        needsFrame = true
        send(["t": "screen", "width": IOSurfaceGetWidth(ref), "height": IOSurfaceGetHeight(ref)])
    }

    // MARK: Streaming

    private func startTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(8), leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in autoreleasepool { self?.tick() } }
        timer.resume()
        self.timer = timer
    }

    private func tick() {
        let now = uptime()
        if udid != nil && now - lastCheck > 500_000_000 { checkDevice() }
        guard let surface, !paused else { return }
        // One frame in flight at a time. Give up on a lost ack after a second.
        if awaitingAck && now - sentAt < 1_000_000_000 { return }
        let seed = IOSurfaceGetSeed(surface)
        guard seed != lastSeed || needsFrame else { return }
        lastSeed = seed
        needsFrame = false
        guard let jpeg = Images.jpeg(surface, maxWidth: maxWidth, quality: quality) else { return }
        awaitingAck = true
        sentAt = now
        sendBinary(jpeg)
    }

    // MARK: Input

    private func clamp(_ value: Any?) -> Double {
        min(max((value as? Double) ?? Double((value as? Int) ?? 0), 0), 1)
    }

    private func touch(_ message: [String: Any]) {
        guard let hid, case .success(let kit) = SimKit.shared else { return }
        let phase = message["phase"] as? String ?? "up"
        var point = CGPoint(x: clamp(message["x"]), y: clamp(message["y"]))
        let eventType: UInt
        switch phase {
        case "down":
            eventType = HID.mouseDown
            let allowEdge = (message["edge"] as? Bool) ?? true
            touchEdge = allowEdge && point.y >= 0.97 ? HID.bottomEdge : 0
        case "move":
            eventType = HID.mouseDragged
        default:
            eventType = HID.mouseUp
        }
        let unit = CGSize(width: 1, height: 1)
        let hidMessage = if (message["pinch"] as? Bool) == true {
            // A second finger mirrored around the screen's center, like Option-drag in Simulator.
            withUnsafePointer(to: CGPoint(x: 1 - point.x, y: 1 - point.y)) { second in
                kit.mouseMessage(&point, second, HID.touchTarget, eventType, unit, touchEdge)
            }
        } else {
            kit.mouseMessage(&point, nil, HID.touchTarget, eventType, unit, touchEdge)
        }
        // Drags closer than 16 ms apart come back nil; the next one carries the position.
        kit.send(hidMessage, to: hid)
        if eventType == HID.mouseUp { touchEdge = 0 }
    }

    private func press(_ source: UInt32, after delay: Double = 0) {
        guard let hid, case .success(let kit) = SimKit.shared else { return }
        queue.asyncAfter(deadline: .now() + delay) {
            kit.send(kit.buttonMessage(source, HID.down, HID.buttonTarget), to: hid)
            self.queue.asyncAfter(deadline: .now() + 0.06) {
                kit.send(kit.buttonMessage(source, HID.up, HID.buttonTarget), to: hid)
            }
        }
    }

    private func button(_ name: String) {
        switch name {
        case "home": press(HID.homeButton)
        case "switcher":
            press(HID.homeButton)
            press(HID.homeButton, after: 0.15)
        case "lock": press(HID.lockButton)
        default: notice("Unknown button \(name).")
        }
    }

    private func key(_ message: [String: Any]) {
        guard let hid, case .success(let kit) = SimKit.shared,
              let usage = message["usage"] as? Int, usage > 0, usage < 0x10000
        else { return }
        let down = (message["down"] as? Bool) ?? false
        kit.send(kit.keyMessage(UInt32(usage), down ? HID.down : HID.up), to: hid)
    }

    private func sendKeys(_ usages: [(Int, Bool)]) {
        guard let hid, case .success(let kit) = SimKit.shared else { return }
        for (index, (usage, down)) in usages.enumerated() {
            queue.asyncAfter(deadline: .now() + Double(index) * 0.03) {
                kit.send(kit.keyMessage(UInt32(usage), down ? HID.down : HID.up), to: hid)
            }
        }
    }

    /// Copies the Mac's clipboard text to the simulator and presses Command-V.
    private func paste() {
        guard let udid else { return }
        guard let text = NSPasteboard.general.string(forType: .string) else {
            return notice("The clipboard has no text to paste.", level: "info")
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let result = simctl(["pbcopy", udid], stdin: Data(text.utf8))
            self?.queue.async {
                guard let self else { return }
                if result.status != 0 { return self.notice("Paste failed: \(result.errorMessage)") }
                let command = 227, v = 25
                self.sendKeys([(command, true), (v, true), (v, false), (command, false)])
            }
        }
    }
}

// MARK: - Server

final class Server {
    private let queue = DispatchQueue(label: "simbridge.server")
    private var listener: NWListener?
    private var sessions: [Int: Session] = [:]
    private var idleExit: DispatchWorkItem?

    func start() throws {
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = true
        websocket.maximumMessageSize = 1 << 20
        websocket.setClientRequestHandler(queue) { _, headers in
            // Only Muxy extension pages may connect, not web pages in a browser.
            let origin = headers.first { $0.name.lowercased() == "origin" }?.value ?? ""
            let allowed = origin.hasPrefix("muxy-ext://")
            if !allowed { log("rejected connection from origin '\(origin)'") }
            return NWProtocolWebSocket.Response(status: allowed ? .accept : .reject, subprotocol: nil)
        }
        let parameters = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: options.port)!)
        parameters.allowLocalEndpointReuse = true

        let listener = try NWListener(using: parameters)
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: log("listening on 127.0.0.1:\(options.port), version \(options.version)")
            case .failed(let error):
                log("listener failed: \(error)")
                exit(2)
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            let session = Session(connection: connection) { [weak self] session in
                self?.queue.async { self?.remove(session) }
            }
            self.sessions[session.id] = session
            self.idleExit?.cancel()
            session.start()
        }
        listener.start(queue: queue)
        self.listener = listener
        scheduleIdleExit(after: max(options.idleExit, 60))
    }

    private func remove(_ session: Session) {
        sessions[session.id] = nil
        if sessions.isEmpty { scheduleIdleExit(after: options.idleExit) }
    }

    private func scheduleIdleExit(after delay: TimeInterval) {
        idleExit?.cancel()
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.sessions.isEmpty else { return }
            log("no panels connected, exiting")
            exit(0)
        }
        idleExit = work
        queue.asyncAfter(deadline: .now() + delay, execute: work)
    }
}

// Leave the launching command's session and process group, so the helper keeps
// running after the command that started it finishes.
_ = setsid()
signal(SIGPIPE, SIG_IGN)
signal(SIGHUP, SIG_IGN)
let server = Server()
do {
    try server.start()
} catch {
    log("couldn't start: \(error)")
    exit(1)
}
// Load the simulator frameworks now, so the first attach is fast.
DispatchQueue.global().async {
    if case .failure(let error) = SimKit.shared { log("\(error)") }
}
dispatchMain()
