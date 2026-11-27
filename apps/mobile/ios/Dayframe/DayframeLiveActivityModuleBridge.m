#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(DayframeLiveActivityModule, NSObject)

RCT_EXTERN_METHOD(apnsEnvironment:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(start:(NSString *)title
                  entryId:(NSString *)entryId
                  apiBase:(NSString *)apiBase
                  categoryName:(NSString *)categoryName
                  categoryColor:(NSString *)categoryColor
                  startedAt:(NSString *)startedAt
                  categoryColorLight:(NSString *)categoryColorLight
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(enableStop:(NSString *)activityId
                  entryId:(NSString *)entryId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(activitySnapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cleanupActivities:(NSArray *)activityIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pushToken:(NSString *)activityId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setShortcutCatalog:(NSString *)value
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pendingShortcutEvents:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removeShortcutEvents:(NSArray *)localIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setRuntimeContext:(NSString *)apiBase
                  sessionToken:(NSString *)sessionToken
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setRuntimeContextWithOwner:(NSString *)apiBase
                  sessionToken:(NSString *)sessionToken
                  userId:(NSString *)userId
                  workspaceId:(NSString *)workspaceId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearRuntimeContext:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clearRuntimeContextIfToken:(NSString *)sessionToken
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end

@interface RCT_EXTERN_MODULE(DayframeWatchBridge, RCTEventEmitter)
RCT_EXTERN_METHOD(updateTimerSnapshot:(NSString *)revision entryId:(NSString *)entryId startedAt:(NSString *)startedAt)
RCT_EXTERN_METHOD(completeTimerCommand:(NSString *)requestId accepted:(BOOL)accepted)
@end

@interface RCT_EXTERN_MODULE(DayframeDeviceDisplay, NSObject)
RCT_EXTERN_METHOD(landscapeEnabled:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(setLandscapeEnabled:(BOOL)enabled resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
