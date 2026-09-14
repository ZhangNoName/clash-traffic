# Third-party notices

Clash 流量簿 0.2.0 uses these third-party components:

| Component | Version | Role | License / source |
| --- | --- | --- | --- |
| Flatpickr | 4.6.13 | Offline date/time picker | MIT; `clash_traffic/static/vendor/flatpickr/LICENSE.md`; https://github.com/flatpickr/flatpickr/tree/v4.6.13 |
| Python | 3.9 | Bundled backend runtime | Python Software Foundation License; https://docs.python.org/3.9/license.html |
| PyYAML | 6.0.3 | Local YAML parsing | MIT; https://github.com/yaml/pyyaml |
| PyInstaller | 6.22.2 | Build-time application packaging | GPL with distribution exception; https://pyinstaller.org/en/stable/license.html |
| Python-Markdown | 3.7 | Build-time offline manual rendering | BSD; https://github.com/Python-Markdown/markdown |

Flatpickr JS, CSS and Chinese locale were copied from the npm `flatpickr-4.6.13.tgz` distribution without editing the library; custom presentation is in the application's own stylesheet. Its complete MIT notice accompanies the files inside the app's service resources. Python and PyYAML retain their bundled distribution notices. Python-Markdown is a build-only dependency, not required by the installed application.


## Next.js frontend (0.2.0)

The new frontend uses Next.js 16.3.5, React/React DOM 19.3.0, shadcn/ui new-york-v4 source components, Radix UI, Tailwind CSS 4, React Day Picker, date-fns, TanStack Query, Recharts and Lucide icons. Exact dependency versions are locked in `frontend/package-lock.json`. Full available dependency notices, including build dependencies, are bundled in `FRONTEND_LICENSES.txt`. shadcn source is MIT-licensed; see `frontend/SHADCN_LICENSE.md`.

shadcn components were obtained from the official `https://ui.shadcn.com/r/styles/new-york-v4/{component}.json` registry on 2026-09-12. Local changes include utility imports, Chinese close labels, heading semantics, theme and control sizing. Flatpickr remains only in the legacy compatibility assets and is not loaded by the Next frontend.
