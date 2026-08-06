import Foundation
import React

@objc(DayframeLiveActivityModule)
class DayframeLiveActivityModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(start:categoryName:categoryColor:startedAt:resolver:rejecter:)
  func start(
    title: String,
    categoryName: String?,
    categoryColor: String?,
    startedAt: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let result = await DayframeLiveActivityController.start(
        title: title,
        categoryName: categoryName,
        categoryColor: categoryColor,
        startedAt: Self.date(from: startedAt) ?? Date()
      )
      let payload: [String: Any] = [
        "started": result != nil,
        "activityId": result?.activityId ?? NSNull()
      ]
      resolve(payload)
    }
  }

  @objc(pushToken:resolver:rejecter:)
  func pushToken(
    activityId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let token = await DayframeLiveActivityController.pushToken(activityId: activityId)
      #if DEBUG
      let environment = "development"
      #else
      let environment = "production"
      #endif
      let payload: [String: Any] = [
        "token": token ?? NSNull(),
        "environment": environment
      ]
      resolve(payload)
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
