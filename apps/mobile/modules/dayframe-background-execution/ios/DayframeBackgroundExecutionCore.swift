import Foundation

public struct DayframeBackgroundExecutionEndDirective: Equatable, Sendable {
  public let generation: Int
  public let leaseTokens: [String]

  public init(generation: Int, leaseTokens: [String]) {
    self.generation = generation
    self.leaseTokens = leaseTokens
  }
}

/// Pure lease state used by the UIKit service. The service owns the platform
/// identifier; this core makes the begin/end transitions deterministic and
/// independently testable.
public struct DayframeBackgroundExecutionCore: Sendable {
  public private(set) var activeGeneration: Int?
  public private(set) var leaseTokens: Set<String> = []
  private var nextGeneration = 0

  public init() {}

  /// Returns the generation that needs a new UIKit task, or nil when an
  /// existing task already owns the new lease.
  public mutating func acquire(leaseToken: String) -> Int? {
    guard !leaseToken.isEmpty, !leaseTokens.contains(leaseToken) else { return nil }
    leaseTokens.insert(leaseToken)
    guard activeGeneration == nil else { return nil }
    nextGeneration += 1
    activeGeneration = nextGeneration
    return nextGeneration
  }

  /// Rolls back a platform begin that returned `.invalid`.
  public mutating func beginFailed(generation: Int) -> [String] {
    guard activeGeneration == generation else { return [] }
    let affected = leaseTokens.sorted()
    leaseTokens.removeAll()
    activeGeneration = nil
    return affected
  }

  /// Releases one lease. Only the last unique release returns an end
  /// directive, so the UIKit identifier is ended exactly once.
  public mutating func release(leaseToken: String) -> DayframeBackgroundExecutionEndDirective? {
    guard leaseTokens.remove(leaseToken) != nil else { return nil }
    guard leaseTokens.isEmpty, let generation = activeGeneration else { return nil }
    activeGeneration = nil
    return DayframeBackgroundExecutionEndDirective(
      generation: generation,
      leaseTokens: [leaseToken]
    )
  }

  /// Expiry and account/lifecycle teardown atomically consume every lease.
  public mutating func endAll(generation: Int? = nil) -> DayframeBackgroundExecutionEndDirective? {
    guard let activeGeneration else { return nil }
    if let generation, generation != activeGeneration { return nil }
    let affected = leaseTokens.sorted()
    leaseTokens.removeAll()
    self.activeGeneration = nil
    return DayframeBackgroundExecutionEndDirective(
      generation: activeGeneration,
      leaseTokens: affected
    )
  }
}

