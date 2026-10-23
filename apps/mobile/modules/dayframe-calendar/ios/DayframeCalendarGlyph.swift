import SwiftUI
import UIKit

// Dayframe registry glyphs (packages/shared iconGlyphs.ts) rendered to template PNGs by
// scripts/generate-icons.mjs and shipped in the DayframeCalendarGlyphs resource bundle.
// Presentation only: the glyph takes the surrounding foreground style.
private final class DayframeCalendarGlyphBundleToken {}

enum DayframeCalendarGlyphs {
  static let bundle: Bundle = {
    let candidates = [Bundle(for: DayframeCalendarGlyphBundleToken.self), Bundle.main]
    for candidate in candidates {
      if let url = candidate.url(forResource: "DayframeCalendarGlyphs", withExtension: "bundle"),
         let bundle = Bundle(url: url) {
        return bundle
      }
    }
    return Bundle(for: DayframeCalendarGlyphBundleToken.self)
  }()

  static func image(named name: String) -> UIImage? {
    UIImage(named: name, in: bundle, compatibleWith: nil)?.withRenderingMode(.alwaysTemplate)
  }
}

struct DayframeCalendarGlyph: View {
  let name: String
  // Points; 24-point registry art scales with the 2-point stroke.
  let size: CGFloat
  /// False: exactly `size` points, for a caller that already applies (and caps) the text scale.
  var followsTextSize = true

  @ScaledMetric(relativeTo: .caption2) private var scale: CGFloat = 1

  var body: some View {
    let side = followsTextSize ? size * scale : size
    if let image = DayframeCalendarGlyphs.image(named: name) {
      Image(uiImage: image)
        .renderingMode(.template)
        .resizable()
        .interpolation(.high)
        .frame(width: side, height: side)
    } else {
      Color.clear.frame(width: side, height: side)
    }
  }
}
