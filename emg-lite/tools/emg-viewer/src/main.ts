import './style.css';
import { Editor } from './editor';
import { Viewer } from './viewer';

console.log('Main starting');

document.addEventListener('DOMContentLoaded', () => {
  const viewer = new Viewer();
  const editor = new Editor();
  // @ts-ignore
  window.editor = editor;

  editor.subscribe((state) => {
    viewer.update(state);
  });

  // Editor -> Viewer: Image Override
  editor.onImageLoad = (url) => viewer.setOverrideImage(url);
  editor.onBlink = (closed) => viewer.setBlinking(closed);
  editor.onBlobUpdate = (map) => viewer.setBlobMap(map);

  // Editor -> Viewer: Model Update & Reference Grid
  editor.onModelUpdate = (def) => {
    viewer.setModelDefinition(def);
    renderReferenceGrid(def);
  };

  // Error UI Wiring
  const errorBanner = document.getElementById('error-banner');
  const errorPath = document.getElementById('error-path');

  viewer.onError = (path) => {
    if (errorBanner && errorPath) {
      errorBanner.style.display = 'block';
      errorPath.textContent = path;
    }
  };
  viewer.onSuccess = () => {
    if (errorBanner) errorBanner.style.display = 'none';
  };

  // Helper: Render Reference Grid
  const renderReferenceGrid = (def: EMGModelDefinition) => {
    const grid = document.getElementById('reference-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const images = new Set<string>();
    if (def && def.mapping) {
      Object.values(def.mapping).forEach(map => {
        if (map.base) images.add(map.base);
        if (map.mouthOpen) images.add(map.mouthOpen);
        if (map.eyesClosed) images.add(map.eyesClosed);
      });
    }

    if (images.size === 0) {
      grid.innerHTML = '<p style="font-size:0.7em; color:#666;">No assets defined.</p>';
      return;
    }

    images.forEach(imgName => {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.flexDirection = 'column';
      wrapper.style.alignItems = 'center';
      wrapper.style.marginBottom = '10px';

      const img = document.createElement('img');
      const src = `${def.assetsRoot}/${imgName}`;

      img.src = src;
      img.style.width = '60px';
      img.style.height = '60px';
      img.style.objectFit = 'contain';
      img.style.border = '1px solid #555';
      img.style.background = '#333';
      img.title = src;
      img.onerror = () => { img.style.opacity = '0.3'; };

      const label = document.createElement('span');
      label.textContent = imgName;
      label.style.fontSize = '0.7em';
      label.style.color = '#aaa';
      label.style.maxWidth = '80px';
      label.style.overflow = 'hidden';
      label.style.textOverflow = 'ellipsis';
      label.style.whiteSpace = 'nowrap';

      wrapper.appendChild(img);
      wrapper.appendChild(label);
      grid.appendChild(wrapper);
    });
  };

  // Initial Render
  viewer.update(editor.getState());
  renderReferenceGrid(editor.getModelDefinition());
});
