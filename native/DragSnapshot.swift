import AppKit
import Foundation

// Read only URL representations on the dedicated drag pasteboard.
// Never access NSPasteboard.general or enumerate arbitrary pasteboard content.
struct Snapshot: Codable {
    let protocolVersion: Int
    let changeCount: Int
    let paths: [String]
}

enum Failure: Error {
    case invalid(String)
}

func snapshot(_ pasteboard: NSPasteboard) throws -> Snapshot {
    let before = pasteboard.changeCount
    guard let items = pasteboard.pasteboardItems, !items.isEmpty else {
        throw Failure.invalid("NO_FILE_URLS")
    }
    guard items.count <= 32 else { throw Failure.invalid("TOO_MANY_FILES") }
    var paths: [String] = []
    for item in items {
        guard let raw = item.string(forType: .fileURL),
              raw.utf8.count <= 32768,
              let url = URL(string: raw), url.isFileURL,
              url.host == nil || url.host == "" || url.host == "localhost",
              url.query == nil, url.fragment == nil else {
            throw Failure.invalid("NOT_LOCAL_FILE_URL")
        }
        let path = url.path
        guard path.hasPrefix("/"), path != "/", path.utf8.count <= 8192,
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
              !path.contains("\"") else {
            throw Failure.invalid("UNREPRESENTABLE_PATH")
        }
        guard !paths.contains(path) else { throw Failure.invalid("DUPLICATE_PATH") }
        paths.append(path)
    }
    guard before == pasteboard.changeCount else { throw Failure.invalid("DRAG_CHANGED") }
    return Snapshot(protocolVersion: 1, changeCount: before, paths: paths)
}

func emit<T: Encodable>(_ value: T) throws {
    let data = try JSONEncoder().encode(value)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([10]))
}

// The self-test uses an isolated, transient pasteboard, never the user's drag.
func selfTest() throws {
    let board = NSPasteboard.withUniqueName()
    defer { board.releaseGlobally() }
    let first = NSPasteboardItem()
    first.setString("file:///tmp/finder-reference-test/%E4%B8%AD%E6%96%87%20a.txt", forType: .fileURL)
    let second = NSPasteboardItem()
    second.setString("file:///tmp/finder-reference-test/b.txt", forType: .fileURL)
    board.clearContents()
    guard board.writeObjects([first, second]) else { throw Failure.invalid("SELF_TEST_WRITE") }
    let result = try snapshot(board)
    guard result.paths == ["/tmp/finder-reference-test/中文 a.txt", "/tmp/finder-reference-test/b.txt"] else {
        throw Failure.invalid("SELF_TEST_PATHS")
    }
    board.clearContents()
    let invalid = NSPasteboardItem()
    invalid.setString("https://example.invalid/file.txt", forType: .fileURL)
    guard board.writeObjects([invalid]) else { throw Failure.invalid("SELF_TEST_WRITE") }
    do {
        _ = try snapshot(board)
        throw Failure.invalid("SELF_TEST_ACCEPTED_REMOTE")
    } catch Failure.invalid(let message) where message == "NOT_LOCAL_FILE_URL" {
        try emit(["status": "passed", "scope": "isolated-pasteboard-only"])
    }
}

 do {
    guard CommandLine.arguments.count == 2 else { throw Failure.invalid("INVALID_ARGUMENTS") }
    switch CommandLine.arguments[1] {
    case "snapshot":
        try emit(snapshot(NSPasteboard(name: .drag)))
    case "self-test":
        try selfTest()
    default:
        throw Failure.invalid("INVALID_ARGUMENTS")
    }
} catch Failure.invalid(let code) {
    try? emit(["error": code])
    exit(1)
} catch {
    try? emit(["error": "NATIVE_FAILURE"])
    exit(1)
}
