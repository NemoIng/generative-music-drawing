import type { SavedComposition } from '../engine/types';
import { getNextVersionName } from '../engine/strokeManager';
import { loadSavedPresets, savePreset, deleteSavedPreset } from './storage';
import { showToast } from './toast';
import { activateModalFocusTrap } from './modalFocus';
import { showConfirmDialog } from './confirmModal';

export interface PresetModalDeps {
  buildCurrentCompositionExport: (nameOverride?: string) => SavedComposition;
  loadComposition: (comp: SavedComposition) => Promise<void> | void;
  getCurrentCompositionName: () => string | null;
  setCurrentCompositionName: (name: string | null) => void;
  setCurrentLoadedTemplateId: (id: string) => void;
  setCompositionDirty: (dirty: boolean) => void;
  getTemplates: () => Record<string, { name: string }>;
  hasActiveStrokes?: () => boolean;
  onFallbackToTemplate?: (templateId: string) => Promise<void> | void;
  onPresetSaved?: (name: string, comp: SavedComposition) => void;
  onPresetDeleted?: (name: string) => void;
}

export class PresetModalController {
  private cleanups: Array<() => void> = [];
  private releaseFocusTrap: (() => void) | null = null;
  private quickSaveResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly deps: PresetModalDeps,
    private readonly root: Document = document
  ) {}

  private listen<K extends keyof HTMLElementEventMap>(
    el: EventTarget | null | undefined,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void {
    if (!el) return;
    const listener = handler as EventListener;
    el.addEventListener(type, listener);
    this.cleanups.push(() => el.removeEventListener(type, listener));
  }

  private getSavedPresetsRecord(): Record<string, SavedComposition> {
    const presets = loadSavedPresets();
    const record: Record<string, SavedComposition> = {};
    for (const preset of presets) {
      record[preset.name] = preset;
    }
    return record;
  }

  private createTrashSvgIcon(): SVGSVGElement {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = this.root.createElementNS(svgNs, 'svg');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const poly = this.root.createElementNS(svgNs, 'polyline');
    poly.setAttribute('points', '3 6 5 6 21 6');
    const path = this.root.createElementNS(svgNs, 'path');
    path.setAttribute('d', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2');
    const line1 = this.root.createElementNS(svgNs, 'line');
    line1.setAttribute('x1', '10');
    line1.setAttribute('y1', '11');
    line1.setAttribute('x2', '10');
    line1.setAttribute('y2', '17');
    const line2 = this.root.createElementNS(svgNs, 'line');
    line2.setAttribute('x1', '14');
    line2.setAttribute('y1', '11');
    line2.setAttribute('x2', '14');
    line2.setAttribute('y2', '17');

    svg.append(poly, path, line1, line2);
    return svg;
  }

  private updateSaveModalButtonLabels(enteredName: string): void {
    const store = this.getSavedPresetsRecord();
    const clean = enteredName.trim() || 'Preset';
    const nextVer = getNextVersionName(clean, store);

    const overwritePresetBtn = this.root.getElementById('overwritePresetBtn');
    const saveNewVersionBtn = this.root.getElementById('saveNewVersionBtn');
    const saveCustomNameBtn = this.root.getElementById('saveCustomNameBtn');

    if (overwritePresetBtn) {
      overwritePresetBtn.textContent = `Overwrite "${clean}"`;
    }
    if (saveNewVersionBtn) {
      saveNewVersionBtn.textContent = `Save as New Version ("${nextVer}")`;
    }
    if (saveCustomNameBtn) {
      saveCustomNameBtn.textContent = 'Save with Entered Name';
    }
  }

  private hasAnyStrokes(): boolean {
    if (this.deps.hasActiveStrokes) {
      return this.deps.hasActiveStrokes();
    }
    return this.deps.buildCurrentCompositionExport().strokes.length > 0;
  }

  public init(): void {
    this.destroy();

    const saveTemplateBtn = this.root.getElementById('saveTemplateBtn');
    const topSavePresetBtn = this.root.getElementById('topSavePresetBtn');
    const topDeletePresetBtn = this.root.getElementById('topDeletePresetBtn');
    const quickSaveBtn = this.root.getElementById('quickSaveBtn');
    const savePresetModal = this.root.getElementById('savePresetModal');
    const closeSavePresetModalBtn = this.root.getElementById('closeSavePresetModalBtn');
    const savePresetNameInput = this.root.getElementById('savePresetNameInput') as HTMLInputElement | null;
    const overwritePresetBtn = this.root.getElementById('overwritePresetBtn');
    const saveNewVersionBtn = this.root.getElementById('saveNewVersionBtn');
    const saveCustomNameBtn = this.root.getElementById('saveCustomNameBtn');
    const saveExportJsonCheck = this.root.getElementById('saveExportJsonCheck') as HTMLInputElement | null;

    this.listen(saveTemplateBtn, 'click', () => {
      this.openSavePresetModal(true);
    });

    this.listen(topSavePresetBtn, 'click', () => {
      this.openSavePresetModal(true);
    });

    this.listen(topDeletePresetBtn, 'click', () => {
      const currentName = this.deps.getCurrentCompositionName();
      if (currentName) {
        void this.deleteCustomPresetByName(currentName);
      }
    });

    this.listen(quickSaveBtn, 'click', () => {
      this.executeQuickSave();
    });

    this.listen(overwritePresetBtn, 'click', () => {
      const targetName =
        savePresetNameInput?.value.trim() || this.deps.getCurrentCompositionName() || 'Preset';
      this.executeSavePreset(targetName, saveExportJsonCheck?.checked ?? false);
    });

    this.listen(saveNewVersionBtn, 'click', () => {
      const targetName =
        savePresetNameInput?.value.trim() || this.deps.getCurrentCompositionName() || 'Preset';
      const saved = this.getSavedPresetsRecord();
      const nextVer = getNextVersionName(targetName, saved);
      this.executeSavePreset(nextVer, saveExportJsonCheck?.checked ?? false);
    });

    this.listen(saveCustomNameBtn, 'click', () => {
      const targetName =
        savePresetNameInput?.value.trim() || this.deps.getCurrentCompositionName() || 'Preset';
      this.executeSavePreset(targetName, saveExportJsonCheck?.checked ?? false);
    });

    this.listen(closeSavePresetModalBtn, 'click', () => {
      this.closeSavePresetModal();
    });

    const backdrop = savePresetModal?.querySelector('.modal-backdrop') ?? null;
    this.listen(backdrop, 'click', () => {
      this.closeSavePresetModal();
    });

    this.listen(savePresetNameInput, 'input', () => {
      if (savePresetNameInput) {
        this.updateSaveModalButtonLabels(savePresetNameInput.value);
      }
    });

    this.listen(savePresetNameInput, 'keydown', (e) => {
      if (e.key === 'Enter' && savePresetNameInput) {
        e.preventDefault();
        this.executeSavePreset(savePresetNameInput.value, saveExportJsonCheck?.checked ?? false);
      }
    });

    this.refreshSavedTemplatesDropdown();
    this.updatePresetDeleteButtons();
  }

  public refreshSavedTemplatesDropdown(): void {
    const savedTemplatesGroup = this.root.getElementById('savedTemplatesGroup');
    if (!savedTemplatesGroup) return;

    const presets = loadSavedPresets();
    savedTemplatesGroup.textContent = '';

    if (presets.length === 0) {
      const emptyOpt = this.root.createElement('option');
      emptyOpt.value = '';
      emptyOpt.disabled = true;
      emptyOpt.textContent = '(No saved presets yet)';
      savedTemplatesGroup.appendChild(emptyOpt);
    } else {
      presets.forEach((preset) => {
        const opt = this.root.createElement('option');
        opt.value = `custom:${preset.name}`;
        opt.textContent = preset.name;
        savedTemplatesGroup.appendChild(opt);
      });
    }

    this.updatePresetDeleteButtons();
  }

  public updatePresetDeleteButtons(): void {
    const presets = loadSavedPresets();
    const currentName = this.deps.getCurrentCompositionName();
    const isCustomActive = Boolean(currentName && presets.some((p) => p.name === currentName));

    const topDeletePresetBtn = this.root.getElementById('topDeletePresetBtn') as HTMLButtonElement | null;
    if (topDeletePresetBtn) {
      topDeletePresetBtn.disabled = !isCustomActive;
      if (isCustomActive && currentName) {
        topDeletePresetBtn.setAttribute(
          'data-tooltip',
          `Delete Preset: Remove "${currentName}" from saved presets`
        );
      } else {
        topDeletePresetBtn.setAttribute(
          'data-tooltip',
          'Delete Preset: Select or load a saved custom preset to delete'
        );
      }
    }
  }

  public renderSavedPresetsManagerList(): void {
    const savedPresetsListContainer = this.root.getElementById('savedPresetsListContainer');
    if (!savedPresetsListContainer) return;

    const presets = loadSavedPresets();
    const savedPresetsCountBadge = this.root.getElementById('savedPresetsCountBadge');
    if (savedPresetsCountBadge) {
      savedPresetsCountBadge.textContent = presets.length.toString();
    }

    savedPresetsListContainer.textContent = '';

    if (presets.length === 0) {
      const empty = this.root.createElement('div');
      empty.className = 'saved-presets-empty-msg';
      empty.textContent = 'No custom presets saved yet.';
      savedPresetsListContainer.appendChild(empty);
      return;
    }

    const currentName = this.deps.getCurrentCompositionName();
    const templateSelect = this.root.getElementById('templateSelect') as HTMLSelectElement | null;

    presets.forEach((comp, idx) => {
      const name = comp.name;
      const row = this.root.createElement('div');
      row.className = 'saved-preset-item-row';

      const info = this.root.createElement('div');
      info.className = 'saved-preset-item-info';

      const nameSpan = this.root.createElement('span');
      nameSpan.className = 'saved-preset-item-name';
      nameSpan.textContent = name;
      info.appendChild(nameSpan);

      if (currentName === name) {
        const activePill = this.root.createElement('span');
        activePill.className = 'saved-preset-item-active-pill';
        activePill.textContent = 'Active';
        info.appendChild(activePill);
      }

      const actions = this.root.createElement('div');
      actions.className = 'saved-preset-item-actions';

      const loadBtn = this.root.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'saved-preset-item-load-btn has-tooltip';
      loadBtn.setAttribute('data-tooltip', `Load preset "${name}"`);
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void (async () => {
          const templateId = `custom:${name}`;
          this.deps.setCurrentLoadedTemplateId(templateId);
          this.deps.setCurrentCompositionName(name);
          await this.deps.loadComposition(comp);
          if (templateSelect) {
            templateSelect.value = templateId;
          }
          this.closeSavePresetModal();
        })();
      });

      const delBtn = this.root.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'saved-preset-item-del-btn has-tooltip';
      delBtn.setAttribute('data-tooltip', `Delete preset "${name}"`);
      delBtn.setAttribute('aria-label', `Delete preset ${name}`);
      delBtn.appendChild(this.createTrashSvgIcon());
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.deleteCustomPresetAtIndex(idx);
      });

      actions.append(loadBtn, delBtn);
      row.append(info, actions);
      savedPresetsListContainer.appendChild(row);
    });
  }

  public async deleteCustomPresetAtIndex(index: number): Promise<boolean> {
    const presets = loadSavedPresets();
    const target = presets[index];
    if (!target) return false;

    const ok = await showConfirmDialog(
      {
        title: 'Delete Preset',
        message: `Delete preset "${target.name}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true,
      },
      this.root
    );
    if (!ok) return false;

    const deleted = deleteSavedPreset(index);
    if (!deleted) {
      showToast('Could not delete preset from browser storage.', 'error');
      return false;
    }

    this.refreshSavedTemplatesDropdown();
    this.renderSavedPresetsManagerList();

    if (this.deps.getCurrentCompositionName() === target.name) {
      const templates = this.deps.getTemplates();
      const fallbackId = templates.cathedralSolitude
        ? 'cathedralSolitude'
        : (Object.keys(templates)[0] ?? 'cathedralSolitude');

      if (this.deps.onFallbackToTemplate) {
        await this.deps.onFallbackToTemplate(fallbackId);
      } else {
        this.deps.setCurrentLoadedTemplateId(fallbackId);
        this.deps.setCurrentCompositionName(templates[fallbackId]?.name ?? null);
        const templateSelect = this.root.getElementById('templateSelect') as HTMLSelectElement | null;
        if (templateSelect) {
          templateSelect.value = fallbackId;
        }
      }
    }

    this.updatePresetDeleteButtons();
    const statMode = this.root.getElementById('statMode');
    if (statMode) {
      statMode.textContent = `Preset Deleted: ${target.name}`;
    }
    this.deps.onPresetDeleted?.(target.name);
    return true;
  }

  public async deleteCustomPresetByName(presetName: string): Promise<boolean> {
    const presets = loadSavedPresets();
    const idx = presets.findIndex((p) => p.name === presetName);
    if (idx === -1) return false;
    return this.deleteCustomPresetAtIndex(idx);
  }

  public openSavePresetModal(forSaveOnly = true): void {
    if (forSaveOnly && !this.hasAnyStrokes()) {
      showToast('Draw or create some musical lines first before saving a preset.', 'error');
      return;
    }

    const activeName =
      this.deps.getCurrentCompositionName() ||
      `Ambient Piece ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    const savePresetNameInput = this.root.getElementById('savePresetNameInput') as HTMLInputElement | null;
    if (savePresetNameInput) {
      savePresetNameInput.value = activeName;
    }

    this.updateSaveModalButtonLabels(activeName);
    this.renderSavedPresetsManagerList();

    const savePresetModal = this.root.getElementById('savePresetModal');
    if (savePresetModal) {
      savePresetModal.classList.remove('hidden');
      this.releaseFocusTrap?.();
      this.releaseFocusTrap = activateModalFocusTrap(savePresetModal);
      savePresetNameInput?.focus();
      savePresetNameInput?.select();
    }
  }

  public closeSavePresetModal(): void {
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    const savePresetModal = this.root.getElementById('savePresetModal');
    if (savePresetModal) {
      savePresetModal.classList.add('hidden');
    }
  }

  public isOpen(): boolean {
    const savePresetModal = this.root.getElementById('savePresetModal');
    return Boolean(savePresetModal && !savePresetModal.classList.contains('hidden'));
  }

  public executeSavePreset(nameToSave: string, downloadJson: boolean): void {
    const cleanName = nameToSave.trim();
    if (!cleanName) return;

    const comp = this.deps.buildCurrentCompositionExport(cleanName);
    const savedOk = savePreset(comp);
    if (!savedOk) {
      showToast('Could not save preset to browser storage (storage full or unavailable).', 'error');
    }

    this.refreshSavedTemplatesDropdown();

    const templateId = `custom:${cleanName}`;
    this.deps.setCurrentLoadedTemplateId(templateId);
    const templateSelect = this.root.getElementById('templateSelect') as HTMLSelectElement | null;
    if (templateSelect) {
      templateSelect.value = templateId;
    }
    this.deps.setCurrentCompositionName(cleanName);
    this.deps.setCompositionDirty(false);

    if (downloadJson) {
      const blob = new Blob([JSON.stringify(comp, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = this.root.createElement('a');
      a.href = url;
      a.download = `${cleanName.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}.json`;
      if (this.root.body) {
        this.root.body.appendChild(a);
        a.click();
        this.root.body.removeChild(a);
      } else {
        a.click();
      }
      URL.revokeObjectURL(url);
    }

    this.closeSavePresetModal();
    this.updatePresetDeleteButtons();
    this.renderSavedPresetsManagerList();

    const statMode = this.root.getElementById('statMode');
    if (statMode) {
      statMode.textContent = `Preset Saved: ${cleanName}`;
    }
    this.deps.onPresetSaved?.(cleanName, comp);

    if (savedOk) {
      showToast(`Preset "${cleanName}" saved!`);
    }
  }

  public executeQuickSave(): void {
    if (!this.hasAnyStrokes()) {
      showToast('Draw or create some musical lines first before saving a preset.', 'error');
      return;
    }

    const store = this.getSavedPresetsRecord();
    const currentName = this.deps.getCurrentCompositionName();
    if (currentName && store[currentName]) {
      this.executeSavePreset(currentName, false);
      const quickSaveBtn = this.root.getElementById('quickSaveBtn');
      if (quickSaveBtn) {
        const orig = quickSaveBtn.textContent;
        quickSaveBtn.textContent = 'Saved!';
        if (this.quickSaveResetTimer !== null) {
          clearTimeout(this.quickSaveResetTimer);
        }
        this.quickSaveResetTimer = setTimeout(() => {
          quickSaveBtn.textContent = orig;
          this.quickSaveResetTimer = null;
        }, 1200);
      }
    } else {
      this.openSavePresetModal(true);
    }
  }

  public destroy(): void {
    if (this.quickSaveResetTimer !== null) {
      clearTimeout(this.quickSaveResetTimer);
      this.quickSaveResetTimer = null;
    }
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    while (this.cleanups.length > 0) {
      this.cleanups.pop()?.();
    }
  }
}
