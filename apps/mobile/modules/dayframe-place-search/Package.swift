// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframePlaceSearch",
  platforms: [.iOS(.v16), .macOS(.v13)],
  products: [
    .library(name: "DayframePlaceSearch", targets: ["DayframePlaceSearch"])
  ],
  targets: [
    .target(
      name: "DayframePlaceSearch",
      path: "ios",
      exclude: [
        "DayframePlaceSearch.podspec",
        "DayframePlaceSearchModule.swift",
        "Tests"
      ],
      sources: ["PlaceSearchCoordinator.swift"],
      linkerSettings: [.linkedFramework("MapKit")]
    ),
    .testTarget(
      name: "DayframePlaceSearchTests",
      dependencies: ["DayframePlaceSearch"],
      path: "ios/Tests"
    )
  ]
)
