#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DayframeLiveActivityModule, NSObject)

RCT_EXTERN_METHOD(start:(NSString *)title
                  categoryName:(NSString *)categoryName
                  categoryColor:(NSString *)categoryColor
                  startedAt:(NSString *)startedAt
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(stop:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pendingShortcutEvents:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removeShortcutEvents:(NSArray *)localIds
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
