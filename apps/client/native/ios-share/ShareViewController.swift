import Social
import UniformTypeIdentifiers

final class ShareViewController: SLComposeServiceViewController {
    override func isContentValid() -> Bool { true }

    override func didSelectPost() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first else {
            extensionContext?.cancelRequest(
                withError: NSError(domain: "KnowledgeBaseShare", code: 1)
            )
            return
        }

        guard let typeIdentifier = ShareAttachmentResolver.preferredTypeIdentifier(
            from: provider.registeredTypeIdentifiers
        ) else {
            extensionContext?.cancelRequest(
                withError: NSError(domain: "KnowledgeBaseShare", code: 4)
            )
            return
        }

        if typeIdentifier == UTType.fileURL.identifier {
            provider.loadItem(
                forTypeIdentifier: typeIdentifier,
                options: nil
            ) { item, error in
                do {
                    if let error { throw error }
                    guard let url = item as? URL else {
                        throw NSError(domain: "KnowledgeBaseShare", code: 2)
                    }
                    _ = try ShareQueueWriter().enqueueFile(at: url)
                    self.extensionContext?.completeRequest(returningItems: nil)
                } catch {
                    self.extensionContext?.cancelRequest(withError: error)
                }
            }
            return
        }

        if typeIdentifier == UTType.url.identifier {
            provider.loadItem(
                forTypeIdentifier: typeIdentifier,
                options: nil
            ) { item, error in
                do {
                    if let error { throw error }
                    guard let url = item as? URL else {
                        throw NSError(domain: "KnowledgeBaseShare", code: 3)
                    }
                    _ = try ShareQueueWriter().enqueueURL(url)
                    self.extensionContext?.completeRequest(returningItems: nil)
                } catch {
                    self.extensionContext?.cancelRequest(withError: error)
                }
            }
            return
        }

        provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) {
            url, error in
            do {
                if let error { throw error }
                guard let url else {
                    throw NSError(domain: "KnowledgeBaseShare", code: 4)
                }
                _ = try ShareQueueWriter().enqueueFile(at: url)
                self.extensionContext?.completeRequest(returningItems: nil)
            } catch {
                self.extensionContext?.cancelRequest(withError: error)
            }
        }
    }

    override func configurationItems() -> [Any]! { [] }
}
