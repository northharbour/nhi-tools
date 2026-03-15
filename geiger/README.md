# Geiger Counter PWA

A Progressive Web App (PWA) for audio-based Geiger counter detection. This app listens for 4kHz beeps from radiation detectors and displays real-time counts in CPS (Counts Per Second) and CPM (Counts Per Minute).

## Features

✓ **Works Offline** - Full functionality without internet after initial load
✓ **Installable** - Add to home screen on iOS and Android
✓ **Real-time Detection** - Responsive 4kHz frequency detection
✓ **Privacy-Focused** - No data collection or cloud transmission
✓ **Responsive Design** - Works on phones, tablets, and desktops
✓ **Safe Area Support** - Notch and status bar aware on mobile
✓ **Adjustable Settings** - Customize sensitivity, frequency, and beep duration

## How to Use

### Quick Start
1. Open the app in your browser or install it
2. Grant microphone access when prompted
3. Click "Start Listening"
4. Point device microphone toward the Geiger counter speaker
5. Adjust sensitivity slider until you get reliable detections

### Reading the Display
- **CPS**: Counts detected in the last second (real-time)
- **CPM**: Counts per minute (annualized from current detection rate)
- **Total Clicks**: Total count since pressing "Start"
- **Peak CPS**: Highest CPS value achieved in current session
- **Uptime**: How long counting has been active

### Settings
- **Sensitivity**: Higher = more sensitive, may pick up noise. Start at 50% and adjust.
- **Frequency**: Set to match your detector. Most are 4 kHz (adjustable 2-8 kHz)
- **Beep Duration**: Minimum time between count detections (prevents double-counting)

### Frequency Detection (Canvas)
The frequency visualization shows:
- **Red bars**: Audio frequency spectrum
- **Yellow line**: Target frequency (your selected frequency)
- **Green line**: Detected match (appears when a matching frequency is found)

## Installation

### Web Hosting

1. **Copy files to your web server:**
   - index.html
   - style.css
   - app.js
   - manifest.json
   - service-worker.js

2. **Configure your web server:**
   - HTTPS is required for service workers (use Let's Encrypt for free certificates)
   - Ensure proper MIME types:
     - `.json` → `application/json`
     - `.js` → `application/javascript`
     - `.css` → `text/css`

3. **Update manifest.json if needed:**
   - Change `start_url` to match your domain
   - Update `scope` to your app path

### Local Development

For testing locally before deploying:

```bash
# Using Python 3
python -m http.server 8000

# Or using Node.js http-server
npx http-server

# Then visit: http://localhost:8000
```

## Installation on Devices

### Android
1. Open the app in Chrome or Edge
2. Tap the menu (⋮) → "Install app"
3. Tap "Install"
4. App installs to home screen

### iOS 13+
1. Open app in Safari
2. Tap Share button (⬆️ from bottom)
3. Scroll and tap "Add to Home Screen"
4. Tap "Add"
5. App works as standalone app

Note: iOS PWAs have limitations - they don't show in app store but work as web clips.

## Technical Details

### Audio Analysis
- FFT size: 4096 samples for high frequency resolution
- Sampling rate: Device dependent (typically 48 kHz)
- Beep detection: Requires 3+ consecutive detections to prevent noise false positives
- Frequency matching: ±300 Hz range around target frequency by default

### Performance
- Lightweight: ~15 KB minified
- Uses Web Audio API for frequency analysis
- RequestAnimationFrame for smooth visualization
- Service worker caching with network fallback

### Browser Support
- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (PWA works as web clip)
- Opera: Full support

## Troubleshooting

### No detections
1. Check microphone is unmuted and working
2. Lower sensitivity slider
3. Verify detector is making 4 kHz beeps (not clicks)
4. Check frequency slider matches your detector

### Too many false detections
1. Increase sensitivity slider to minimum needed
2. Adjust beep duration to prevent double-counting
3. Reduce frequency range (tighten around target frequency)
4. Use in quieter environment

### App not saving data
This is normal - the app doesn't store persistent data. Refresh to start fresh.

### Service worker not caching
Make sure you're on HTTPS and app was accessed normally (not in private mode in some browsers)

## Advanced Configuration

To modify detection parameters, edit `app.js`:

```javascript
this.targetFrequency = 4000;        // Frequency in Hz
this.frequencyRange = 300;          // ±Hz around target
this.minConsecutiveDetections = 3;  // Detections required to register a count
```

## License

Free to use and modify. No attribution required.

## Notes

- This app only processes audio locally in your browser. No audio is sent anywhere.
- Works best in quiet environments
- Each detector model may have slightly different beep characteristics - adjust settings accordingly
- For accurate measurements, verify with manufacturer specifications

---

**Created for radiation detection enthusiasts and researchers.**

Enjoy safe detecting! ☢️
