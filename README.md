# Network Map Tray App

**Tray Application for Windows (x64)**

## Setup

1. **Add an icon**  
   Place a 16×16 or 32×32 PNG image named `trayIcon.png` in this directory.

2. **Install dependencies**  
   ```powershell
   cd tray-app
   npm install
   ```

3. **Run in development**  
   ```powershell
   npm start
   ```

4. **Package for Windows**  
   ```powershell
   npm run package
   ```
   The packaged application will appear under `dist/network-map-tray-win32-x64/`.


5. **Windows Autostart**
Create a registry file called networkmaptrayappautostart.reg

Paste the following without the **:

**
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run]
"NetworkMapTrayApp"="\"C:\\Path\\To\\network-map-tray-win32-x64\\network-map-tray.exe\" --hidden"
**

Key name (NetworkMapTrayApp) is arbitrary; pick something descriptive.

Value must be the full quoted path to your .exe.

The optional --hidden (or any flag you define) could tell your app to start minimized.

Double-click networkmaptrayappautostart.reg and confirm the import.