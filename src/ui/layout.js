// tresD DICOM — construcción del DOM (misma disposición que VOXEL).
import { t } from '../i18n/i18n.js';
import { VERSION } from '../version.js';

export function buildLayout(root) {
  root.innerHTML = `
  <header class="topbar">
    <div class="row">
      <div class="brand" title="tresD DICOM">
        <img id="brand-img" alt="tresD DICOM">
      </div>
      <div class="vsep"></div>
      <div id="patient-chip" class="hidden" data-i18n-title="pat_chip_tip"></div>
      <button id="btn-patient-edit" class="btn-ghost btn-icon hidden" data-i18n-title="pat_edit_tip">✎</button>
      <div class="spacer"></div>
      <button id="btn-new" class="btn-ghost hidden" data-i18n="new_btn" data-i18n-title="new_tip"></button>
      <button id="btn-undo" class="btn-ghost btn-icon hidden" data-i18n-title="undo_tip" disabled>↶</button>
      <button id="btn-redo" class="btn-ghost btn-icon hidden" data-i18n-title="redo_tip" disabled>↷</button>
      <button id="btn-meta" class="btn-ghost hidden" data-i18n="meta_btn"></button>
      <button id="btn-shot" class="btn-ghost hidden">📷 <span data-i18n="shot_btn"></span></button>
      <button id="btn-rotate" class="btn-ghost hidden" aria-pressed="false">⟳ <span data-i18n="rotate_btn"></span></button>
      <button id="btn-feedback" class="btn-ghost" data-i18n="fb_btn" data-i18n-title="fb_hint"></button>
      <button id="btn-font" class="btn-ghost btn-icon" data-i18n-title="font_btn">Aa</button>
      <button id="btn-help" class="btn-ghost btn-icon" data-i18n-title="help_btn">?</button>
      <button id="btn-theme" class="btn-ghost btn-icon" data-i18n-title="theme_btn">◐</button>
      <button id="btn-lang" class="btn-ghost btn-icon" data-i18n-title="lang_btn">ES</button>
      <span class="version">v${VERSION}</span>
    </div>
    <div class="row hidden" id="view-bar">
      <button class="btn-ghost" data-view="frontal" data-i18n="view_frontal"></button>
      <button class="btn-ghost" data-view="lat_r" data-i18n="view_lat_r"></button>
      <button class="btn-ghost" data-view="lat_l" data-i18n="view_lat_l"></button>
      <button class="btn-ghost" data-view="sup" data-i18n="view_sup"></button>
      <button class="btn-ghost" data-view="inf" data-i18n="view_inf"></button>
      <button class="btn-ghost" data-view="post" data-i18n="view_post"></button>
      <button class="btn-ghost" id="btn-center" data-i18n="view_center"></button>
      <div class="layout-group">
        <button class="btn-ghost" data-layout="quad" data-i18n="layout_quad"></button>
        <button class="btn-ghost" data-layout="main3" data-i18n="layout_main3"></button>
        <button class="btn-ghost" data-layout="row" data-i18n="layout_row"></button>
        <button class="btn-ghost" data-layout="vp3d" data-i18n="layout_3d"></button>
        <button class="btn-ghost" data-layout="vpAx" data-i18n="layout_axial"></button>
        <button class="btn-ghost" data-layout="vpCor" data-i18n="layout_coronal"></button>
        <button class="btn-ghost" data-layout="vpSag" data-i18n="layout_sagittal"></button>
        <button class="btn-ghost" data-layout="vpPan" data-i18n="layout_pan"></button>
        <button class="btn-ghost hidden" data-layout="vpAtm" id="lay-atm" data-i18n="layout_atm"></button>
      </div>
      <button class="btn-ghost" id="btn-cross" aria-pressed="false" data-i18n="cross_btn" data-i18n-title="cross_tip"></button>
      <div class="spacer"></div>
    </div>
  </header>

  <div class="body" id="body">
    <div class="sidewrap left" id="wrap-left"><div class="hot"></div>
    <aside id="side" class="pane">
      <div class="phead"><h1 class="h1" data-i18n="step_import"></h1><button class="btn-ghost btn-icon pin" data-pin="left" data-i18n-title="pin_btn">⟨</button></div>
      <div class="group" id="g1">
        <div class="gtitle" data-i18n="g1_title"></div>
        <button id="btn-folder" class="btn-primary" data-i18n="upload_folder"></button>
        <button id="btn-files" class="btn-ghost big" data-i18n="upload_files"></button>
        <button id="btn-zip" class="btn-ghost big" data-i18n="upload_zip"></button>
        <input id="in-folder" type="file" webkitdirectory directory multiple hidden>
        <input id="in-files" type="file" multiple hidden>
        <input id="in-zip" type="file" accept=".zip" hidden>
      </div>
      <div class="group" id="g2">
        <div class="gtitle" data-i18n="g2_title"></div>
        <button id="btn-mesh" class="btn-ghost big" data-i18n="upload_mesh"></button>
        <input id="in-mesh" type="file" accept=".stl,.ply,.obj" multiple hidden>
      </div>
      <div class="group hidden" id="g3">
        <div class="gtitle" data-i18n="g3_title"></div>
        <button id="btn-photo" class="btn-ghost big" data-i18n="photo_btn"></button>
        <button id="btn-seg" class="btn-ghost big" data-i18n="seg_btn"></button>
        <input id="in-photo" type="file" accept="image/*" hidden>
        <button id="btn-airway" class="btn-ghost big" data-i18n="airway_btn"></button>
        <button id="btn-atm" class="btn-ghost big" data-i18n="atm_btn"></button>
      </div>
      <div class="group hidden" id="g-series">
        <div class="gtitle" data-i18n="series_title"></div>
        <div id="series-list" class="series-list"></div>
      </div>
      <div class="group hidden" id="g-tools">
        <div class="gtitle" data-i18n="tools_title"></div>
        <div class="chkcol">
          <label class="chk"><input type="checkbox" id="cut-x"><span data-i18n="cut_sag"></span></label>
          <label class="chk"><input type="checkbox" id="cut-z"><span data-i18n="cut_axi"></span></label>
          <label class="chk"><input type="checkbox" id="cut-y"><span data-i18n="cut_cor"></span></label>
          <label class="chk"><input type="checkbox" id="cut-flip" disabled><span data-i18n="cut_flip"></span></label>
        </div>
        <input type="range" id="cut-slider" min="0" max="100" value="50" disabled>
        <div class="tools">
          <button id="btn-dist" class="btn-ghost" aria-pressed="false" data-i18n="measure_dist"></button>
          <button id="btn-ang" class="btn-ghost" aria-pressed="false" data-i18n="measure_ang"></button>
          <button id="btn-clear" class="btn-ghost" data-i18n="measure_clear"></button>
        </div>
      </div>
      <div class="hint" id="lbl-import" data-i18n="nothing_yet"></div>
    </aside>
    </div>

    <section id="center">
      <div id="main-drop" class="drop">
        <img id="main-logo" alt="tresD DICOM viewer">
        <span class="drop-cta" data-i18n="drop_big" style="white-space:pre-line"></span>
        <span class="owner" data-i18n="owner_line"></span>
      </div>
      <div id="grid" data-layout="quad" class="hidden">
        ${vp('vp3d', 'vp_3d')}${vp('vpAx', 'vp_axial')}${vp('vpCor', 'vp_coronal')}${vp('vpSag', 'vp_sagittal')}
        <div class="vp hidden" data-id="vpPan">
          <div class="pan-wrap"><canvas id="pan-canvas"></canvas></div>
          <div class="pan-bar">
            <label data-i18n="pan_thick"></label><input type="range" id="pan-thick" min="1" max="40" value="22"><span id="pan-thick-val">22 mm</span>
            <label class="chk"><input type="checkbox" id="pan-mip" checked><span data-i18n="pan_mip"></span></label>
            <label class="chk"><input type="checkbox" id="pan-curve"><span data-i18n="pan_curve"></span></label>
            <span class="spacer" style="flex:1"></span>
            <button class="btn-ghost" id="pan-len" aria-pressed="false" data-i18n="ab_len" data-i18n-title="ab_len_tip"></button>
            <button class="btn-ghost" id="pan-ang" aria-pressed="false" data-i18n="ab_ang" data-i18n-title="ab_ang_tip"></button>
            <button class="btn-ghost hidden" id="pan-clear" data-i18n="atm_clear"></button>
            <button class="btn-ghost" id="pan-edit" aria-pressed="false" data-i18n="pan_edit" data-i18n-title="pan_edit_tip"></button>
            <button class="btn-ghost" id="pan-draw" data-i18n="pan_draw" data-i18n-title="pan_draw_tip"></button>
            <button class="btn-ghost" id="pan-reset" data-i18n="pan_reset"></button>
          </div>
          <span class="vplabel" data-i18n="vp_pan"></span>

          <span class="orient l">D</span><span class="orient r">I</span>
        </div>
        <div class="vp hidden" data-id="vpAtm">
          <div class="atm-grid" id="atm-grid"></div>
          <div class="pan-bar">
            <span class="atm-legend" data-i18n="atm_legend"></span>
            <button class="btn-ghost" id="atm-poles" data-i18n="atm_poles" data-i18n-title="atm_poles_tip"></button>
            <button class="btn-ghost" id="atm-clear" data-i18n="atm_clear"></button>
            <button class="btn-ghost" id="atm-redo" data-i18n="atm_redo"></button>
          </div>
          <span class="vplabel" data-i18n="vp_atm"></span>
        </div>
      </div>
    </section>

    <div class="sidewrap right hidden" id="wrap-right"><div class="hot"></div>
    <aside id="vispanel" class="pane">
      <div class="phead"><div class="vtitle" data-i18n="vis_title"></div>
        <button class="btn-ghost btn-icon hidden" id="btn-export" data-i18n-title="export_tip">⭳</button>
        <button class="btn-ghost btn-icon pin" data-pin="right" data-i18n-title="pin_btn">⟩</button></div>
      <div class="card dicom">
        <div class="card-title">
          <label class="chk"><input type="checkbox" id="dicom-vis" checked><span data-i18n="dicom_card"></span></label>
          <span class="spacer" style="flex:1"></span>
          <button id="dicom-del" class="btn-trash" data-i18n-title="remove_dicom">✕</button>
        </div>
        <div class="wrow"><label data-i18n="opacity"></label><input type="range" id="dicom-op" min="2" max="100" value="100"></div>
        <div class="wrow"><label data-i18n="brightness"></label><input type="range" id="dicom-level" min="-1000" max="3000" value="1250"></div>
        <div class="wrow"><label data-i18n="contrast"></label><input type="range" id="dicom-window" min="50" max="4000" value="1900"></div>
        <div class="wrow"><label data-i18n="render_preset"></label>
          <select id="dicom-preset">
            <option value="ivory" data-i18n="preset_ivory"></option>
            <option value="natural" data-i18n="preset_natural"></option>
            <option value="radio" data-i18n="preset_radio"></option>
            <option value="gray" data-i18n="preset_gray"></option>
            <option value="soft" data-i18n="preset_soft"></option>
            <option value="airway" data-i18n="preset_airway"></option>
            <option value="default" data-i18n="preset_default"></option>
          </select>
        </div>
        <div class="wrow"><label class="chk"><input type="checkbox" id="sil-vis" checked><span data-i18n="silhouettes"></span></label></div>
      </div>
      <div class="card dicom collapsible" id="mpr-card">
        <button class="ctitle" data-i18n="mpr_card"></button>
        <div class="ccontent">
          ${mprRow('z', 'mpr_axial')}${mprRow('y', 'mpr_coronal')}${mprRow('x', 'mpr_sagittal')}
        </div>
      </div>
      <div id="mesh-cards"></div>
    </aside>
    </div>
  </div>

  <footer class="status"><span id="status-text" data-i18n="st_ready"></span><div class="progress hidden" id="progress"><div></div></div>
    <span class="legal-links"><a href="#" data-legal="terms" data-i18n="legal_terms"></a> · <a href="#" data-legal="notice" data-i18n="legal_notice"></a> · <a href="#" data-legal="privacy" data-i18n="legal_privacy"></a></span></footer>

  <div id="meta-drawer">
    <div class="mhead">
      <h2 data-i18n="meta_title"></h2>
      <input type="search" id="meta-search" data-i18n-ph="meta_search">
      <button id="meta-json" class="btn-ghost" data-i18n="meta_export_json"></button>
      <button id="meta-csv" class="btn-ghost" data-i18n="meta_export_csv"></button>
      <button id="meta-close" class="btn-ghost" data-i18n="meta_close"></button>
    </div>
    <div class="msummary" id="meta-summary"></div>
    <div class="small" style="padding:4px 12px" data-i18n="meta_from_first"></div>
    <div class="mbody"><table class="tbl" id="meta-table"><thead><tr>
      <th data-i18n="meta_tag"></th><th data-i18n="meta_name"></th><th data-i18n="meta_vr"></th><th data-i18n="meta_value"></th>
    </tr></thead><tbody></tbody></table></div>
  </div>`;
}

function vp(id, labelKey) {
  const orient = id === 'vp3d' ? '' : `<span class="orient t"></span><span class="orient b"></span><span class="orient l"></span><span class="orient r"></span>`;
  const bar = id === 'vp3d' ? `<div class="pa-bar hidden" id="pa-bar"><span id="pa-text"></span><button class="btn-ghost" id="pa-undo" data-i18n="dlg_undo"></button><button class="btn-ghost" id="pa-cancel" data-i18n="dlg_cancel"></button></div>`
    : id === 'vpSag' ? `<div class="pa-bar hidden" id="aw-bar"><span id="aw-text"></span><button class="btn-ghost" id="aw-undo" data-i18n="dlg_undo"></button><button class="btn-ghost" id="aw-cancel" data-i18n="dlg_cancel"></button></div>`
      : id === 'vpCor' ? `<div class="pa-bar hidden" id="atm-bar"><span id="atm-text"></span><button class="btn-ghost" id="atm-undo" data-i18n="dlg_undo"></button><button class="btn-ghost" id="atm-cancel" data-i18n="dlg_cancel"></button></div>`
        : id === 'vpAx' ? `<div class="pa-bar hidden" id="pd-bar"><span id="pd-text"></span><button class="btn-ghost" id="pd-undo" data-i18n="dlg_undo"></button><button class="btn-primary" id="pd-done" data-i18n="pd_done" style="width:auto;min-height:28px;padding:2px 12px"></button><button class="btn-ghost" id="pd-cancel" data-i18n="dlg_cancel"></button></div>
          <div class="pa-bar hidden" id="pe-bar"><span id="pe-text" data-i18n="pe_text"></span><button class="btn-ghost" id="pe-reset" data-i18n="pan_reset"></button><button class="btn-primary" id="pe-done" data-i18n="pe_done" style="width:auto;min-height:28px;padding:2px 12px"></button></div>` : '';
  return `<div class="vp" data-id="${id}">
    <div class="cs" id="${id}" oncontextmenu="return false"></div>${bar}
    <span class="vplabel" data-i18n="${labelKey}"></span>
    <span class="vpinfo"></span>${orient}
    <button class="btn-ghost vpmax" data-max="${id}" data-i18n-title="maximize">⤢</button>
  </div>`;
}

/** Tarjeta de un escáner en el panel derecho (como las tarjetas de malla de VOXEL / tresD Models). */
export function meshCard(item) {
  const el = document.createElement('div');
  el.className = 'card mesh'; el.dataset.mesh = item.id;
  el.innerHTML = `
    <div class="card-title">
      <label class="chk"><input type="checkbox" class="m-vis" checked><span class="m-name"></span></label>
      <span class="spacer" style="flex:1"></span>
      <button class="btn-trash m-del" data-i18n-title="remove_mesh">✕</button>
    </div>
    <div class="wrow"><label data-i18n="opacity"></label><input type="range" class="m-op" min="2" max="100" value="100"></div>
    <div class="wrow"><label data-i18n="mesh_color"></label><input type="color" class="m-color" value="${item.color}">
      <label class="chk m-real${item.colors ? '' : ' hidden'}"><input type="checkbox" class="m-usecol" checked><span data-i18n="mesh_real_color"></span></label></div>
    <div class="wrow m-tools"><button class="btn-ghost m-flip" data-i18n="mesh_flip"></button><button class="btn-ghost m-align hidden" data-i18n="mesh_align" data-i18n-title="mesh_align_tip"></button><button class="btn-ghost m-points hidden" data-i18n="mesh_points" data-i18n-title="mesh_points_tip"></button></div>
    <div class="wrow m-photo hidden"><label class="chk"><input type="checkbox" class="m-photo-vis" checked><span data-i18n="mesh_photo"></span></label><span class="spacer" style="flex:1"></span><button class="btn-trash m-photo-del" data-i18n-title="remove_photo">✕</button></div>
    <div class="wrow m-heat hidden"><label class="chk"><input type="checkbox" class="m-heat-on" checked><span data-i18n="aw_heat"></span></label></div>
    <div class="aw-values hidden"></div>`;
  el.querySelector('.m-name').textContent = item.name;
  return el;
}

function mprRow(axis, key) {
  return `<div class="wrow"><label class="chk" style="min-width:90px"><input type="checkbox" id="mpr-${axis}"><span data-i18n="${key}"></span></label>
    <input type="range" id="mpr-${axis}-sl" min="0" max="100" value="50" disabled></div>`;
}

/** Letras de orientación (marco LPS): Axial A/P + D/I; Coronal S/I + D/I; Sagital S/I + A/P. */
export function orientationLetters(lang) {
  const R = lang === 'en' ? 'R' : 'D', L = lang === 'en' ? 'L' : 'I';
  return {
    vpAx: { t: 'A', b: 'P', l: R, r: L },
    vpCor: { t: 'S', b: 'I', l: R, r: L },
    vpSag: { t: 'S', b: 'I', l: 'A', r: 'P' },
    vpPan: { l: R, r: L },
  };
}

export { t };
