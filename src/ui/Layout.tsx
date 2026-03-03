import React, { useRef, useEffect } from 'react';
import { Actions, Layout, Model, TabNode } from 'flexlayout-react';
import 'flexlayout-react/style/dark.css';
import { ViewportPanel } from './panels/ViewportPanel';
import { OutlinerPanel } from './panels/OutlinerPanel';
import { AttributeEditorPanel } from './panels/AttributeEditorPanel';
import { ConsolePanel } from './panels/ConsolePanel';
import { CameraViewPanel } from './panels/CameraViewPanel';
import { FloatingWindowManager } from './components/FloatingWindowManager';
import { StatusBar } from './panels/StatusBar';
import { MenuBar } from './components/MenuBar';
import { Toolbar } from './components/Toolbar';
import { SettingsPanelContent } from './panels/SettingsPanelContent';
import { useAppStore } from './store/useAppStore';

const PlaceholderPanel: React.FC<{ title: string }> = ({ title }) => (
  <div style={{
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '8px',
    background: 'var(--maya-bg-dark)',
    color: 'var(--maya-text-dim)',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    fontSize: '12px',
  }}>
    <div style={{ fontSize: '22px', opacity: 0.3 }}>⬚</div>
    <div>{title}</div>
    <div style={{ fontSize: '10px', opacity: 0.5 }}>Coming soon</div>
  </div>
);

const json = {
  global: {
    tabEnableClose: false,
    tabEnableFloat: false,
    tabEnableRename: false,
    tabSetEnableMaximize: true,     // ⊞ maximize-within-layout — the safe "detach" equivalent
    tabSetEnableClose: false,
    tabSetHeaderHeight: 26,
    tabSetTabStripHeight: 26,
    splitterSize: 4,
    borderBarSize: 26,
  },
  borders: [],
  layout: {
    // root row = children placed LEFT → RIGHT
    type: "row",
    weight: 100,
    children: [
      {
        // LEFT — Outliner
        type: "tabset",
        weight: 13,
        children: [
          { type: "tab", name: "Outliner", component: "outliner", enableClose: false, enableFloat: false },
        ]
      },
      {
        // CENTER — viewport on top, console strip at bottom
        type: "col",
        weight: 62,
        children: [
          {
            type: "tabset",
            weight: 87,
            children: [
              { type: "tab", name: "Viewport",     component: "viewport",    enableClose: false, enableFloat: false },
              { type: "tab", name: "Camera View",  component: "camera_view", enableClose: false, enableFloat: false },
            ]
          },
          {
            type: "tabset",
            weight: 13,
            children: [
              { type: "tab", name: "Console", component: "console", enableClose: false, enableFloat: false },
            ]
          }
        ]
      },
      {
        // RIGHT — Attribute Editor / Node Editor / Settings
        type: "tabset",
        weight: 25,
        children: [
          { type: "tab", name: "Attribute Editor", component: "attribute_editor", enableClose: false, enableFloat: false },
          { type: "tab", name: "Node Editor",      component: "node_editor",      enableClose: false, enableFloat: false },
          { type: "tab", id: "#settings",          name: "Settings",             component: "settings",          enableClose: false, enableFloat: false },
        ]
      }
    ]
  }
};

export const AppLayout: React.FC = () => {
  // Use a stable ref but initialise lazily so hot-reload always picks up the latest JSON.
  const model = useRef<Model | null>(null);
  if (!model.current) model.current = Model.fromJson(json);
  const core = useAppStore((s) => s.core);

  // Register the docked Settings tab selector so the store can focus it on demand.
  useEffect(() => {
    useAppStore.getState().registerSelectSettingsTab(() => {
      model.current?.doAction(Actions.selectTab('#settings'));
    });
  }, []);

  const handleUndo = () => core?.commandHistory.undo();
  const handleRedo = () => core?.commandHistory.redo();

  const factory = (node: TabNode) => {
    const component = node.getComponent();
    if (component === "viewport")         return <ViewportPanel />;
    if (component === "camera_view")      return <CameraViewPanel />;
    if (component === "outliner")         return <OutlinerPanel />;
    if (component === "attribute_editor") return <AttributeEditorPanel />;
    if (component === "console")          return <ConsolePanel />;
    if (component === "node_editor")      return <PlaceholderPanel title="Node Editor" />;
    if (component === "settings")          return <SettingsPanelContent />;
    return <PlaceholderPanel title={node.getName()} />;
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--maya-bg-dark)',
        color: 'var(--maya-text)',
        outline: 'none',
      }}
      onKeyDown={(e) => {
        const meta = e.metaKey || e.ctrlKey;
        if (meta && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo(); }
        if (meta && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); handleRedo(); }
      }}
      tabIndex={-1}
    >
      {/* ── Menu Bar ── */}
      <MenuBar />

      {/* ── Shelf / Toolbar ── */}
      <Toolbar />

      {/* ── Dockable panel area ── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Layout model={model.current!} factory={factory} />
        {/* In-app floating windows (camera views etc.) */}
        <FloatingWindowManager />
      </div>

      {/* ── Status Bar ── */}
      <StatusBar />
    </div>
  );
};
