import SwiftUI
import UIKit

extension UIColor {
  convenience init(dayframeCSS value: String) {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if normalized.hasPrefix("#") {
      let hex = String(normalized.dropFirst())
      let expanded: String
      if hex.count == 3 || hex.count == 4 {
        expanded = hex.map { "\($0)\($0)" }.joined()
      } else {
        expanded = hex
      }
      if let raw = UInt64(expanded, radix: 16), expanded.count == 6 || expanded.count == 8 {
        let hasAlpha = expanded.count == 8
        let red = CGFloat((raw >> (hasAlpha ? 24 : 16)) & 0xff) / 255
        let green = CGFloat((raw >> (hasAlpha ? 16 : 8)) & 0xff) / 255
        let blue = CGFloat((raw >> (hasAlpha ? 8 : 0)) & 0xff) / 255
        let alpha = hasAlpha ? CGFloat(raw & 0xff) / 255 : 1
        self.init(red: red, green: green, blue: blue, alpha: alpha)
        return
      }
    }

    if normalized.lowercased().hasPrefix("rgba("), normalized.hasSuffix(")") {
      let components = normalized
        .dropFirst(5)
        .dropLast()
        .split(separator: ",")
        .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
      if components.count == 4 {
        self.init(
          red: CGFloat(components[0] / 255),
          green: CGFloat(components[1] / 255),
          blue: CGFloat(components[2] / 255),
          alpha: CGFloat(components[3])
        )
        return
      }
    }

    self.init(white: 0, alpha: 0)
  }

  func dayframeBlended(over background: UIColor, alpha: CGFloat) -> UIColor {
    var foregroundRed: CGFloat = 0
    var foregroundGreen: CGFloat = 0
    var foregroundBlue: CGFloat = 0
    var foregroundAlpha: CGFloat = 0
    var backgroundRed: CGFloat = 0
    var backgroundGreen: CGFloat = 0
    var backgroundBlue: CGFloat = 0
    var backgroundAlpha: CGFloat = 0
    getRed(&foregroundRed, green: &foregroundGreen, blue: &foregroundBlue, alpha: &foregroundAlpha)
    background.getRed(&backgroundRed, green: &backgroundGreen, blue: &backgroundBlue, alpha: &backgroundAlpha)
    let amount = min(1, max(0, alpha * foregroundAlpha))
    return UIColor(
      red: foregroundRed * amount + backgroundRed * (1 - amount),
      green: foregroundGreen * amount + backgroundGreen * (1 - amount),
      blue: foregroundBlue * amount + backgroundBlue * (1 - amount),
      alpha: 1
    )
  }
}

extension Color {
  init(dayframeCSS value: String) {
    self.init(uiColor: UIColor(dayframeCSS: value))
  }
}
