// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeLocationVisits",
  platforms: [.iOS(.v16)],
  products: [
    .library(name: "DayframeLocationVisits", targets: ["DayframeLocationVisits"])
  ],
  targets: [
    .target(
      name: "DayframeLocationVisits",
      path: "ios",
      exclude: [
        "DayframeLocationAppDelegateSubscriber.swift",
        "DayframeLocationVisits.podspec",
        "DayframeLocationVisitsModule.swift",
        "Tests"
      ],
      sources: ["DayframeLocationVisitService.swift"],
      linkerSettings: [
        .linkedFramework("CoreLocation"),
        .linkedFramework("UIKit")
      ]
    ),
    .testTarget(
      name: "DayframeLocationVisitsTests",
      dependencies: ["DayframeLocationVisits"],
      path: "ios/Tests"
    )
  ]
)
