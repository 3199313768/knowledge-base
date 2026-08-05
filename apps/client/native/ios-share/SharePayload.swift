import Foundation

enum ShareAttachmentResolver {
    static let pdfTypeIdentifier = "com.adobe.pdf"
    static let fileURLTypeIdentifier = "public.file-url"
    static let urlTypeIdentifier = "public.url"

    static func preferredTypeIdentifier(from identifiers: [String]) -> String? {
        for preferred in [
            pdfTypeIdentifier,
            fileURLTypeIdentifier,
            urlTypeIdentifier,
        ] where identifiers.contains(preferred) {
            return preferred
        }

        return identifiers.first
    }
}

struct SharePayload: Codable, Equatable {
    enum Kind: String, Codable {
        case file
        case url
    }

    let id: UUID
    let kind: Kind
    let displayName: String
    let storedFileName: String?
    let sourceURL: String?
    let createdAt: Date
}
