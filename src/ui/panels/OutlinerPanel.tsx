import React, { useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { ChevronRight, ChevronDown, Box, Camera, Eye, EyeOff, FolderOpen, FolderMinus, MonitorPlay } from 'lucide-react';
import { dispatchScene } from '../buses';

type DropSide = 'before' | 'after' | 'into';
type DropIndicator = { uuid: string; side: DropSide } | null;

const NODE_TYPE_ICON: Record<string, React.ReactNode> = {
  MeshNode:   <Box        size={12} style={{ color: '#7ec89c', flexShrink: 0 }} />,
  CameraNode: <Camera     size={12} style={{ color: '#a0c8f0', flexShrink: 0 }} />,
  GroupNode:  <FolderOpen size={12} style={{ color: '#d4a46e', flexShrink: 0 }} />,
  DAGNode:    <Eye        size={12} style={{ color: '#888',    flexShrink: 0 }} />,
};

const getNodeIcon = (node: any) => NODE_TYPE_ICON[node.nodeType] ?? NODE_TYPE_ICON['DAGNode'];

/** Compute drop side from mouse Y within the element. */
function getDragSide(e: React.DragEvent): DropSide {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const relY = e.clientY - rect.top;
  const h = rect.height;
  if (relY < h * 0.33) return 'before';
  if (relY > h * 0.67) return 'after';
  return 'into';
}

const OutlinerNode: React.FC<{
  node: any;
  depth: number;
  selectedNodes: any[];
  dropIndicator: DropIndicator;
  visibleSet: Set<string> | null;
  searchQuery: string;
  collapsed: Set<string>;
  onToggleCollapse: (uuid: string) => void;
  onSelect:    (node: any, e: React.MouseEvent) => void;
  onToggleVis: (node: any) => void;
  onOpenCameraView: (node: any) => void;
  onDragStart: (nodeUuid: string, e: React.DragEvent) => void;
  onDragOver:  (nodeUuid: string, side: DropSide, e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop:      (targetNodeUuid: string, side: DropSide, e: React.DragEvent) => void;
}> = ({
  node, depth, selectedNodes, dropIndicator, visibleSet, searchQuery,
  collapsed, onToggleCollapse,
  onSelect, onToggleVis, onOpenCameraView,
  onDragStart, onDragOver, onDragLeave, onDrop,
}) => {
  // Filter: skip nodes not in visibleSet
  if (visibleSet !== null && !visibleSet.has(node.uuid)) return null;

  // When filtering, force-expand all nodes so matching children are visible
  const expanded     = visibleSet !== null ? true : !collapsed.has(node.uuid);
  const isSelected   = selectedNodes.includes(node);
  const hasChildren  = node.children && node.children.length > 0;
  const isVisible: boolean = node.visibility?.getValue() ?? true;
  // WorldRoot (DAGNode with no parent) is not draggable
  const isDraggable  = !(node.nodeType === 'DAGNode' && node.parent === null);

  const dropInd = dropIndicator?.uuid === node.uuid ? dropIndicator.side : null;
  const nameMatches = visibleSet !== null && node.name?.toLowerCase().includes(searchQuery.trim().toLowerCase());

  return (
    <div>
      <div
        draggable={isDraggable}
        onDragStart={e => { if (isDraggable) onDragStart(node.uuid, e); }}
        onDragOver={e => { onDragOver(node.uuid, getDragSide(e), e); }}
        onDragLeave={e => onDragLeave(e)}
        onDrop={e => onDrop(node.uuid, getDragSide(e), e)}
        onMouseDown={e => { onSelect(node, e); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '2px 6px 2px 0',
          paddingLeft: `${depth * 14 + 4}px`,
          cursor: isDraggable ? 'grab' : 'default',
          userSelect: 'none',
          fontSize: '12px',
          fontFamily: '"Segoe UI", system-ui, sans-serif',
          background: dropInd === 'into'
            ? 'rgba(82,133,166,0.30)'
            : isSelected ? 'var(--maya-accent)' : 'transparent',
          color: isSelected ? '#fff' : 'var(--maya-text)',
          borderLeft: isSelected ? '2px solid var(--maya-accent-hover)' : '2px solid transparent',
          borderTop:    dropInd === 'before' ? '2px solid #5da3d9' : '2px solid transparent',
          borderBottom: dropInd === 'after'  ? '2px solid #5da3d9' : '2px solid transparent',
          boxSizing: 'border-box',
          transition: 'background 0.08s',
        }}
        onMouseEnter={e => { if (!isSelected && dropInd !== 'into') (e.currentTarget as HTMLElement).style.background = 'var(--maya-tab-hover)'; }}
        onMouseLeave={e => { if (!isSelected && dropInd !== 'into') (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        {/* Expand toggle */}
        <span
          style={{ width: '16px', flexShrink: 0, opacity: hasChildren ? 0.8 : 0, cursor: 'pointer' }}
          onMouseDown={e => { e.stopPropagation(); onToggleCollapse(node.uuid); }}
        >
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>

        {/* Type icon */}
        <span style={{ marginRight: '5px', display: 'flex', alignItems: 'center' }}>
          {getNodeIcon(node)}
        </span>

        {/* Name — highlighted when it directly matches the filter */}
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
          fontStyle: node.nodeType === 'DAGNode' ? 'italic' : 'normal',
          opacity: !isVisible ? 0.4 : node.nodeType === 'DAGNode' ? 0.5 : 1,
          color: nameMatches ? '#ffd966' : undefined,
          fontWeight: nameMatches ? 600 : undefined,
        }}>
          {node.name}
        </span>

        {/* Open Camera View — only for CameraNode */}
        {node.nodeType === 'CameraNode' && (
          <span
            onMouseDown={e => { e.stopPropagation(); onOpenCameraView(node); }}
            style={{
              flexShrink: 0, padding: '0 3px', display: 'flex', alignItems: 'center',
              opacity: 0.35, cursor: 'pointer', color: '#a0c8f0',
            }}
            title="Open Camera Viewport"
          >
            <MonitorPlay size={11} />
          </span>
        )}

        {/* Visibility eye */}
        <span
          onMouseDown={e => { e.stopPropagation(); onToggleVis(node); }}
          style={{
            flexShrink: 0, padding: '0 4px', display: 'flex', alignItems: 'center',
            opacity: isVisible ? 0.35 : 0.9,
            color: isVisible ? 'inherit' : '#f48771',
          }}
          title="Toggle Visibility"
        >
          {isVisible ? <Eye size={10} /> : <EyeOff size={10} />}
        </span>
      </div>

      {expanded && hasChildren && node.children.map((child: any) => (
        <OutlinerNode
          key={child.uuid}
          node={child}
          depth={depth + 1}
          selectedNodes={selectedNodes}
          dropIndicator={dropIndicator}
          visibleSet={visibleSet}
          searchQuery={searchQuery}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onSelect={onSelect}
          onToggleVis={onToggleVis}
          onOpenCameraView={onOpenCameraView}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
};

// ── Helpers ────────────────────────────────────────────────────────────────────────────────
/** Depth-first flat list of visible (non-collapsed) nodes, skipping WorldRoot itself. */
function buildFlatList(node: any, collapsed: Set<string>, result: any[] = []): any[] {
  // Skip the WorldRoot wrapper, but walk its children
  if (node.parent !== null) result.push(node);
  if (!collapsed.has(node.uuid) && node.children) {
    for (const child of node.children) buildFlatList(child, collapsed, result);
  }
  return result;
}

// ── Panel ──────────────────────────────────────────────────────────────────────────────────
export const OutlinerPanel: React.FC = () => {
  const core           = useAppStore(state => state.core);
  const selectedNodes  = useAppStore(state => state.selectedNodes);
  useAppStore(state => state.sceneVersion);
  const markSceneDirty = useAppStore(state => state.markSceneDirty);
  const openCameraView = useAppStore(state => state.openCameraView);

  const [, setTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  /** UUIDs of collapsed nodes (expand-by-default, so store exceptions). */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  const dragUuid = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);

  if (!core) return null;

  // ── Filter: compute set of UUIDs that should be visible ───────────────────
  let visibleSet: Set<string> | null = null;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    visibleSet = new Set<string>();
    const checkNode = (node: any): boolean => {
      const selfMatch: boolean = (node.name as string)?.toLowerCase().includes(q) ?? false;
      if (selfMatch) (visibleSet as Set<string>).add(node.uuid);
      let anyChild = false;
      for (const child of (node.children ?? [])) {
        if (checkNode(child)) { (visibleSet as Set<string>).add(node.uuid); anyChild = true; }
      }
      return selfMatch || anyChild;
    };
    checkNode(core.sceneGraph.root);
  }

  const handleToggleCollapse = (uuid: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(uuid) ? next.delete(uuid) : next.add(uuid);
      return next;
    });
  };

  const handleSelect = (node: any, e: React.MouseEvent) => {
    const isRange = e.shiftKey;
    const isMulti = e.metaKey || e.ctrlKey;

    if (isRange && lastClickedRef.current) {
      // Maya-style: select all visible nodes between last click and this one
      const flat = buildFlatList(core.sceneGraph.root, collapsed);
      const curIdx  = flat.findIndex(n => n.uuid === node.uuid);
      const lastIdx = flat.findIndex(n => n.uuid === lastClickedRef.current);
      if (curIdx !== -1 && lastIdx !== -1) {
        const lo = Math.min(curIdx, lastIdx);
        const hi = Math.max(curIdx, lastIdx);
        core.selectionManager.clear();
        for (let i = lo; i <= hi; i++) {
          core.selectionManager.select(flat[i], true);
        }
        return;
      }
    }

    lastClickedRef.current = node.uuid;
    core.selectionManager.select(node, isMulti);
  };

  const handleToggleVis = (node: any) => {
    const current: boolean = node.visibility?.getValue() ?? true;
    node.visibility?.setValue(!current);
    setTick(t => t + 1);
  };

  const handleOpenCameraView = (node: any) => {
    openCameraView(node.uuid, node.name);
  };

  const handleDragStart = (nodeUuid: string, e: React.DragEvent) => {
    dragUuid.current = nodeUuid;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', nodeUuid);
  };

  const handleDragOver = (nodeUuid: string, side: DropSide, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (nodeUuid !== dragUuid.current) {
      setDropIndicator({ uuid: nodeUuid, side });
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropIndicator(null);
    }
  };

  const handleDrop = (targetNodeUuid: string, side: DropSide, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropIndicator(null);
    const srcUuid = dragUuid.current;
    dragUuid.current = null;
    if (!srcUuid || srcUuid === targetNodeUuid) return;

    if (side === 'into') {
      // Reparent: make srcNode a child of targetNode
      dispatchScene.reparentNode(srcUuid, targetNodeUuid);
    } else {
      // Reorder: insert src before/after target within target's parent
      const targetNode = core.sceneGraph.getNodeById(targetNodeUuid);
      if (!targetNode?.parent) {
        // Fallback: move to WorldRoot
        dispatchScene.reparentNode(srcUuid, core.sceneGraph.root.uuid);
        markSceneDirty();
        return;
      }
      const parentUuid = targetNode.parent.uuid;
      const targetIndex = targetNode.parent.children.indexOf(targetNode);
      const insertIndex = side === 'before' ? targetIndex : targetIndex + 1;
      dispatchScene.reorderNode(srcUuid, parentUuid, insertIndex);
    }
    markSceneDirty();
  };

  const hasGroupSelected = selectedNodes.some((n: any) => n.nodeType === 'GroupNode');

  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
      background: 'var(--maya-bg-dark)',
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '4px 6px', background: 'var(--maya-tab-strip)',
        borderBottom: '1px solid var(--maya-border)',
        display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
      }}>
        <input
          type="text" placeholder="Filter…" value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: 1, padding: '2px 6px', fontSize: '11px',
            background: 'var(--maya-bg-input)', border: '1px solid var(--maya-border)',
            borderRadius: '2px', color: 'var(--maya-text)', outline: 'none',
            fontFamily: '"Segoe UI", system-ui, sans-serif',
          }}
        />
        <button
          title="Group selected  (⌘G / Ctrl+G)"
          onClick={() => dispatchScene.groupSelected()}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px',
            fontSize: '10px', background: 'transparent',
            border: '1px solid var(--maya-border)', borderRadius: 2,
            color: 'var(--maya-text-muted)', cursor: 'pointer',
            fontFamily: '"Segoe UI", system-ui, sans-serif', flexShrink: 0,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--maya-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--maya-text)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--maya-border)'; (e.currentTarget as HTMLElement).style.color = 'var(--maya-text-muted)'; }}
        >
          <FolderOpen size={11} /> Group
        </button>
        <button
          title={hasGroupSelected ? 'Ungroup selected  (⌘⇧G / Ctrl+Shift+G)' : 'Select a group node to ungroup'}
          onClick={() => dispatchScene.ungroupSelected()}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: '2px 6px',
            fontSize: '10px', background: 'transparent',
            border: '1px solid var(--maya-border)', borderRadius: 2,
            color: hasGroupSelected ? 'var(--maya-text-muted)' : 'var(--maya-text-dim)',
            cursor: 'pointer', fontFamily: '"Segoe UI", system-ui, sans-serif', flexShrink: 0,
          }}
          onMouseEnter={e => { if (hasGroupSelected) { (e.currentTarget as HTMLElement).style.borderColor = 'var(--maya-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--maya-text)'; } }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--maya-border)'; (e.currentTarget as HTMLElement).style.color = hasGroupSelected ? 'var(--maya-text-muted)' : 'var(--maya-text-dim)'; }}
        >
          <FolderMinus size={11} /> Ungroup
        </button>
      </div>

      {/* Tree — also acts as a drop zone to re-parent to WorldRoot */}
      <div
        style={{ flex: 1, overflowY: 'auto' }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropIndicator({ uuid: core.sceneGraph.root.uuid, side: 'into' }); }}
        onDragLeave={() => setDropIndicator(null)}
        onDrop={e => { e.preventDefault(); handleDrop(core.sceneGraph.root.uuid, 'into', e); }}
      >
        <OutlinerNode
          node={core.sceneGraph.root}
          depth={0}
          selectedNodes={selectedNodes}
          dropIndicator={dropIndicator}
          visibleSet={visibleSet}
          searchQuery={searchQuery}
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
          onSelect={handleSelect}
          onToggleVis={handleToggleVis}
          onOpenCameraView={handleOpenCameraView}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
      </div>
    </div>
  );
};
