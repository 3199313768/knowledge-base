import Foundation

enum ShareQueueError: Error {
    case appGroupUnavailable
}

struct ShareQueueWriter {
    static let appGroupID = "group.com.local.knowledgebase"

    private let fileManager = FileManager.default

    func enqueueFile(at sourceURL: URL) throws -> SharePayload {
        guard let container = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupID
        ) else {
            throw ShareQueueError.appGroupUnavailable
        }

        let id = UUID()
        let inbox = container.appendingPathComponent("Inbox", isDirectory: true)
        let queue = container.appendingPathComponent("Queue", isDirectory: true)
        try fileManager.createDirectory(
            at: inbox,
            withIntermediateDirectories: true,
            attributes: nil
        )
        try fileManager.createDirectory(
            at: queue,
            withIntermediateDirectories: true,
            attributes: nil
        )

        let storedName = "\(id.uuidString)-\(sourceURL.lastPathComponent)"
        let destination = inbox.appendingPathComponent(storedName)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.copyItem(at: sourceURL, to: destination)

        let payload = SharePayload(
            id: id,
            kind: .file,
            displayName: sourceURL.lastPathComponent,
            storedFileName: storedName,
            sourceURL: nil,
            createdAt: Date()
        )
        try write(payload, to: queue)
        return payload
    }

    func enqueueURL(_ url: URL) throws -> SharePayload {
        guard let container = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroupID
        ) else {
            throw ShareQueueError.appGroupUnavailable
        }
        let queue = container.appendingPathComponent("Queue", isDirectory: true)
        try fileManager.createDirectory(
            at: queue,
            withIntermediateDirectories: true,
            attributes: nil
        )
        let payload = SharePayload(
            id: UUID(),
            kind: .url,
            displayName: url.absoluteString,
            storedFileName: nil,
            sourceURL: url.absoluteString,
            createdAt: Date()
        )
        try write(payload, to: queue)
        return payload
    }

    private func write(_ payload: SharePayload, to queue: URL) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(payload)
        let destination = queue.appendingPathComponent("\(payload.id.uuidString).json")
        try data.write(to: destination, options: .atomic)
    }
}
