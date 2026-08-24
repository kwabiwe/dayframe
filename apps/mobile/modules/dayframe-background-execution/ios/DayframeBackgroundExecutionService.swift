import Foundation
import UIKit

@MainActor
final class DayframeBackgroundExecutionService {
  var onExpired: ((Int, [String]) -> Void)?

  private var core = DayframeBackgroundExecutionCore()
  private var taskIdentifier: UIBackgroundTaskIdentifier = .invalid

  func begin(name: String) -> String? {
    let leaseToken = UUID().uuidString
    guard let generation = core.acquire(leaseToken: leaseToken) else {
      return leaseToken
    }

    let identifier = UIApplication.shared.beginBackgroundTask(
      withName: normalizedName(name),
      expirationHandler: { [weak self] in
        Task { @MainActor in
          self?.expire(generation: generation)
        }
      }
    )
    guard identifier != .invalid else {
      _ = core.beginFailed(generation: generation)
      return nil
    }
    taskIdentifier = identifier
    return leaseToken
  }

  @discardableResult
  func end(leaseToken: String) -> Bool {
    guard let directive = core.release(leaseToken: leaseToken) else { return false }
    endPlatformTask(generation: directive.generation)
    return true
  }

  @discardableResult
  func endAll() -> Int {
    guard let directive = core.endAll() else { return 0 }
    endPlatformTask(generation: directive.generation)
    return directive.leaseTokens.count
  }

  private func expire(generation: Int) {
    guard let directive = core.endAll(generation: generation) else { return }
    // UIKit requires the task to end promptly from the expiration path. JS is
    // notified only after the native identifier has been consumed.
    endPlatformTask(generation: directive.generation)
    onExpired?(directive.generation, directive.leaseTokens)
  }

  private func endPlatformTask(generation: Int) {
    guard core.activeGeneration != generation else { return }
    let identifier = taskIdentifier
    taskIdentifier = .invalid
    guard identifier != .invalid else { return }
    UIApplication.shared.endBackgroundTask(identifier)
  }

  private func normalizedName(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "Dayframe timer sync" : String(trimmed.prefix(96))
  }
}

