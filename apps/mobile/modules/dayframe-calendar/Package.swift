// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "DayframeCalendarCore",
  platforms: [
    .macOS(.v13),
    .iOS(.v16)
  ],
  products: [
    .library(name: "DayframeCalendarCore", targets: ["DayframeCalendarCore"])
  ],
  targets: [
    .target(
      name: "DayframeCalendarCore",
      path: "ios",
      exclude: [
        "DayframeCalendar.podspec",
        "DayframeCalendarColor.swift",
        "DayframeCalendarExpoView.swift",
        "DayframeCalendarModel.swift",
        "DayframeCalendarModule.swift",
        "DayframeCalendarRootView.swift",
        "DayframeCalendarScrollCoordinator.swift"
      ],
      sources: ["DayframeCalendarCore.swift", "DayframeCalendarRecords.swift"]
    ),
    .testTarget(
      name: "DayframeCalendarCoreTests",
      dependencies: ["DayframeCalendarCore"],
      path: "Tests"
    )
  ]
)
