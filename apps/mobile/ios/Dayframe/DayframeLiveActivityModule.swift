import Foundation
import React

@objc(DayframeLiveActivityModule)
class DayframeLiveActivityModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(start:entryId:apiBase:categoryName:categoryColor:startedAt:resolver:rejecter:)
  func start(
    title: String,
    entryId: String?,
    apiBase: String?,
    categoryName: String?,
    categoryColor: String?,
    startedAt: String?,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let result = await DayframeLiveActivityController.start(
        entryId: entryId,
        apiBase: apiBase,
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

  @objc(enableStop:entryId:resolver:rejecter:)
  func enableStop(
    activityId: String,
    entryId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      resolve(await DayframeLiveActivityController.enableStop(
        activityId: activityId,
        entryId: entryId
      ))
    }
  }

  @objc(activitySnapshot:rejecter:)
  func activitySnapshot(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DayframeLiveActivityController.snapshots().map { snapshot in
      [
        "activityId": snapshot.activityId,
        "entryId": snapshot.entryId ?? NSNull(),
        "isActive": snapshot.isActive,
        "isRunning": snapshot.isRunning
      ] as [String: Any]
    })
  }

  @objc(cleanupActivities:resolver:rejecter:)
  func cleanupActivities(
    activityIds: [String],
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DayframeLiveActivityController.cleanupActivities(activityIds: activityIds)
    resolve(true)
  }

  @objc(pushToken:resolver:rejecter:)
  func pushToken(
    activityId: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      let token = await DayframeLiveActivityController.pushToken(activityId: activityId)
      let payload: [String: Any] = [
        "token": token ?? NSNull(),
        "environment": Self.pushEnvironment() ?? NSNull()
      ]
      resolve(payload)
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

  @objc(setRuntimeContext:sessionToken:resolver:rejecter:)
  func setRuntimeContext(
    apiBase: String,
    sessionToken: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DayframeShortcutRuntimeContextStore.set(apiBase: apiBase, sessionToken: sessionToken))
  }

  @objc(clearRuntimeContext:rejecter:)
  func clearRuntimeContext(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DayframeShortcutRuntimeContextStore.clear()
    resolve(true)
  }

  @objc(clearRuntimeContextIfToken:resolver:rejecter:)
  func clearRuntimeContextIfToken(
    sessionToken: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(DayframeShortcutRuntimeContextStore.clear(sessionToken: sessionToken))
  }

  private static func date(from value: String?) -> Date? {
    guard let value else {
      return nil
    }
    return ISO8601DateFormatter.dayframe.date(from: value)
  }

  private static func pushEnvironment() -> String? {
    guard
      let value = Bundle.main.object(forInfoDictionaryKey: "DayframeAPNSEnvironment") as? String,
      value == "development" || value == "production"
    else {
      return nil
    }
    return value
  }
}
