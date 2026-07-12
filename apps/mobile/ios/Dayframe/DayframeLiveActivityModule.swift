import Foundation
import React

@objc(DayframeLiveActivityModule)
class DayframeLiveActivityModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(start:categoryName:startedAt:resolver:rejecter:)
  func start(
    title: String,
    categoryName: String?,
    startedAt: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let didStart = await DayframeLiveActivityController.start(
        title: title,
        categoryName: categoryName,
        startedAt: Self.date(from: startedAt) ?? Date()
      )
      resolve(didStart)
    }
  }

  @objc(stop:rejecter:)
  func stop(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let didStop = await DayframeLiveActivityController.stop()
      resolve(didStop)
    }
  }

  @objc(pendingShortcutEvents:rejecter:)
  func pendingShortcutEvents(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DayframeNativeShortcutQueue.pendingDictionaries())
  }

  @objc(removeShortcutEvents:resolver:rejecter:)
  func removeShortcutEvents(
    localIds: [String],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DayframeNativeShortcutQueue.remove(localIds: localIds))
  }

  private static func date(from value: String?) -> Date? {
    guard let value else {
      return nil
    }
    return ISO8601DateFormatter.dayframe.date(from: value)
  }
}
