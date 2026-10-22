#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DayframeDiagnosticsModule, NSObject)

RCT_EXTERN_METHOD(jsAnswered)

RCT_EXTERN_METHOD(setJsTasks:(NSArray *)tasks
                  last:(NSString *)last)

RCT_EXTERN_METHOD(overview:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(snapshot:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(clear:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
