// Point d'entrée du client.
import { App } from './app';

const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
if (params.has('chars')) {
  void import('./dev/charGallery').then((m) => m.startCharGallery(root));
} else if (params.has('gallery')) {
  void import('./dev/gallery').then((m) => m.startGallery(root));
} else if (params.has('viewer')) {
  void import('./dev/viewer').then((m) => m.startViewer(root));
} else if (params.has('vm')) { void import('./dev/vmGallery').then((m) => m.startVmGallery(root));
} else if (params.has('cyberui')) {
  void import('./dev/cyberUiLab').then((m) => m.startCyberUiLab(root));
} else if (params.has('fx')) { void import('./dev/fxLab').then((m) => m.startFxLab(root));
} else {
  (window as unknown as { __app: App }).__app = new App(root);
}
