import XCTest

final class ShareQueueWriterTests: XCTestCase {
    func testPDFTypeIsSelectedBeforeGenericURLTypes() {
        let selected = ShareAttachmentResolver.preferredTypeIdentifier(
            from: ["public.url", "com.adobe.pdf", "public.file-url"]
        )

        XCTAssertEqual(selected, "com.adobe.pdf")
    }

    func testPayloadRoundTripPreservesSourceLocation() throws {
        let payload = SharePayload(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!,
            kind: .url,
            displayName: "https://example.com/quote",
            storedFileName: nil,
            sourceURL: "https://example.com/quote",
            createdAt: Date(timeIntervalSince1970: 0)
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(
            SharePayload.self,
            from: encoder.encode(payload)
        )
        XCTAssertEqual(decoded, payload)
    }
}
