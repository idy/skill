import SwiftUI

// Native demonstration. The deterministic repository replaces IO only; every
// entry point uses this same observable state machine and production view.
enum LoadState: Equatable { case empty, loading, ready, error }
@MainActor final class ItineraryStore: ObservableObject {
    @Published var state: LoadState = .empty
    @Published var progress: Double = 0
    private var task: Task<Void, Never>?
    func reset() { task?.cancel(); state = .empty; progress = 0 }
    func load(failing: Bool = false) {
        task?.cancel(); state = .loading; progress = 0
        task = Task {
            for step in 1...12 {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled else { return }
                withAnimation(.linear(duration: 0.2)) { progress = Double(step) / 12 }
            }
            withAnimation(.easeInOut(duration: 0.4)) { state = failing ? .error : .ready }
        }
    }
}

@main struct TrailNotesApp: App {
    @StateObject private var store = ItineraryStore()
    var body: some Scene {
        WindowGroup { ItineraryView(store: store).preferredColorScheme(.light) }
    }
}

struct ItineraryView: View {
    @ObservedObject var store: ItineraryStore
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    HStack {
                        Label("TRAIL NOTES", systemImage: "mountain.2.fill")
                            .font(.caption.bold()).tracking(2).foregroundStyle(.teal)
                        Spacer()
                        Button("Reset", action: store.reset).accessibilityIdentifier("reset")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your next adventure").font(.largeTitle.bold())
                        Text("Plan with confidence, even off the grid.").foregroundStyle(.secondary)
                    }
                    Group {
                        switch store.state {
                        case .empty: empty
                        case .loading: loading
                        case .ready: ready
                        case .error: error
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Text("LOCAL DEMO · Deterministic travel data")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(geometry.size.width > 600 ? 40 : 24)
                .frame(maxWidth: 850)
                .frame(maxWidth: .infinity)
            }.background(Color(red: 0.96, green: 0.97, blue: 0.96))
        }
    }
    private var empty: some View {
        VStack(alignment: .leading, spacing: 20) {
            Image(systemName: "map.fill").font(.system(size: 48)).foregroundStyle(.teal)
            Text("No itinerary yet").font(.title2.bold())
            Text("Download your saved route to see trail details and offline maps.")
            Button("Load itinerary") { store.load() }
                .buttonStyle(.borderedProminent).tint(.teal).accessibilityIdentifier("load")
            Button("Test connection failure") { store.load(failing: true) }
                .accessibilityIdentifier("fail")
        }.padding(24).background(.white, in: RoundedRectangle(cornerRadius: 24))
    }
    private var loading: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Preparing your route").font(.title2.bold())
            ProgressView(value: store.progress).tint(.teal)
            Text("Downloading trail details and offline maps…")
            Text("Keep this screen open.").font(.caption).foregroundStyle(.secondary)
        }.padding(24).background(.white, in: RoundedRectangle(cornerRadius: 24))
    }
    private var ready: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Ready for offline use", systemImage: "checkmark.circle.fill").foregroundStyle(.teal)
            Text("Summit overnight itinerary").font(.title2.bold())
            Text("Pine Ridge Loop").font(.headline)
            HStack(spacing: 24) {
                Label("12.8 km", systemImage: "figure.hiking")
                Label("6 hours", systemImage: "clock")
            }.font(.subheadline)
            Divider()
            // Coverage is essential information; wrap it at the actual card width.
            Text("Offline maps include the full trail and emergency exit routes")
                .font(.body).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Start at North Trailhead · 07:30").font(.subheadline)
            Label("Pack water and a warm layer", systemImage: "backpack")
                .foregroundStyle(.secondary)
        }.padding(24).background(.white, in: RoundedRectangle(cornerRadius: 24))
    }
    private var error: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("Connection unavailable", systemImage: "wifi.slash").font(.title2.bold())
            Text("Your itinerary is safe. Reconnect and try the download again.")
            Button("Try again") { store.load() }
                .buttonStyle(.borderedProminent).tint(.teal).accessibilityIdentifier("retry")
        }.padding(24).background(.white, in: RoundedRectangle(cornerRadius: 24))
    }
}
