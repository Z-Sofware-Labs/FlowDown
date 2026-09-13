import React, { useState } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FolderOpen, 
  FileCode, 
  Check, 
  Minus,
  CheckSquare,
  Square
} from 'lucide-react';
import { formatBytes } from '../utils/formatters';

export interface FileItem {
  path: string;
  size: number;
}

export interface DirectoryTreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  size: number;
  children: DirectoryTreeNode[];
  file?: FileItem;
}

export function buildDirectoryTree(files: FileItem[]): DirectoryTreeNode[] {
  const rootNodes: DirectoryTreeNode[] = [];

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/');
    const parts = normalizedPath.split('/').filter(Boolean);

    let currentLevel = rootNodes;
    let accumulatedPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;

      let existing = currentLevel.find((node) => node.name === part);

      if (!existing) {
        if (isLast) {
          existing = {
            name: part,
            path: accumulatedPath,
            isFolder: false,
            size: file.size,
            children: [],
            file: { path: file.path, size: file.size },
          };
        } else {
          existing = {
            name: part,
            path: accumulatedPath,
            isFolder: true,
            size: 0,
            children: [],
          };
        }
        currentLevel.push(existing);
      }

      if (!isLast) {
        currentLevel = existing.children;
      }
    }
  }

  function calcSize(node: DirectoryTreeNode): number {
    if (!node.isFolder) return node.size;
    node.size = node.children.reduce((acc, child) => acc + calcSize(child), 0);
    return node.size;
  }

  rootNodes.forEach(calcSize);
  return rootNodes;
}

export function getAllFilePathsInNode(node: DirectoryTreeNode): string[] {
  if (!node.isFolder) {
    return node.file ? [node.file.path] : [];
  }
  return node.children.flatMap(getAllFilePathsInNode);
}

export type NodeSelectionStatus = 'checked' | 'unchecked' | 'indeterminate';

export function getNodeSelectionStatus(
  node: DirectoryTreeNode,
  selectedMap: Record<string, boolean>
): NodeSelectionStatus {
  const filePaths = getAllFilePathsInNode(node);
  if (filePaths.length === 0) return 'unchecked';

  let selectedCount = 0;
  for (const p of filePaths) {
    if (selectedMap[p]) selectedCount++;
  }

  if (selectedCount === filePaths.length) return 'checked';
  if (selectedCount === 0) return 'unchecked';
  return 'indeterminate';
}

interface TorrentDirectoryTreeProps {
  files: FileItem[];
  selectedPaths: Record<string, boolean>;
  onTogglePath: (path: string, select: boolean) => void;
  onToggleFolder: (node: DirectoryTreeNode, select: boolean) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

interface TreeNodeItemProps {
  node: DirectoryTreeNode;
  depth?: number;
  selectedPaths: Record<string, boolean>;
  onTogglePath: (path: string, select: boolean) => void;
  onToggleFolder: (node: DirectoryTreeNode, select: boolean) => void;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  depth = 0,
  selectedPaths,
  onTogglePath,
  onToggleFolder,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const status = getNodeSelectionStatus(node, selectedPaths);

  if (node.isFolder) {
    return (
      <div className="select-none">
        <div 
          className="flex items-center justify-between py-1 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded text-[11px] group transition-colors"
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            {/* Expand / Collapse Toggle */}
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>

            {/* Checkbox */}
            <button
              type="button"
              onClick={() => onToggleFolder(node, status !== 'checked')}
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                status === 'checked'
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : status === 'indeterminate'
                  ? 'bg-blue-500/20 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              {status === 'checked' && <Check className="h-3 w-3 stroke-[3]" />}
              {status === 'indeterminate' && <Minus className="h-3 w-3 stroke-[3]" />}
            </button>

            {/* Folder Icon & Name */}
            <div 
              onClick={() => setIsOpen(!isOpen)}
              className="flex items-center space-x-1.5 cursor-pointer min-w-0"
            >
              {isOpen ? (
                <FolderOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              )}
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                {node.name}
              </span>
            </div>
          </div>

          <span className="text-[10px] text-slate-400 font-mono ml-2 shrink-0">
            {formatBytes(node.size)}
          </span>
        </div>

        {/* Children */}
        {isOpen && (
          <div className="space-y-0.5">
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPaths={selectedPaths}
                onTogglePath={onTogglePath}
                onToggleFolder={onToggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // File Node
  const isSelected = !!selectedPaths[node.file!.path];

  return (
    <div 
      className={`flex items-center justify-between py-1 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded text-[11px] transition-colors ${
        !isSelected ? 'opacity-50' : ''
      }`}
      style={{ paddingLeft: `${depth * 14 + 20}px` }}
    >
      <div className="flex items-center space-x-2 min-w-0">
        {/* Checkbox */}
        <button
          type="button"
          onClick={() => onTogglePath(node.file!.path, !isSelected)}
          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
            isSelected
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
          }`}
        >
          {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
        </button>

        {/* File Icon & Name */}
        <div 
          onClick={() => onTogglePath(node.file!.path, !isSelected)}
          className="flex items-center space-x-1.5 cursor-pointer min-w-0"
        >
          <FileCode className="h-3.5 w-3.5 text-slate-400 shrink-0" />
          <span className={`truncate ${isSelected ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'}`}>
            {node.name}
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0 ml-2">
        {!isSelected && (
          <span className="text-[9px] px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-slate-500 font-semibold uppercase">
            Skip
          </span>
        )}
        <span className="text-[10px] text-slate-400 font-mono">
          {formatBytes(node.size)}
        </span>
      </div>
    </div>
  );
};

export const TorrentDirectoryTree: React.FC<TorrentDirectoryTreeProps> = ({
  files,
  selectedPaths,
  onTogglePath,
  onToggleFolder,
  onSelectAll,
  onDeselectAll,
}) => {
  const treeRoots = React.useMemo(() => buildDirectoryTree(files), [files]);

  const totalFiles = files.length;
  const selectedCount = files.filter((f) => selectedPaths[f.path]).length;
  const selectedSize = files.reduce(
    (acc, f) => (selectedPaths[f.path] ? acc + f.size : acc),
    0
  );
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3 space-y-2">
      {/* Header with stats and select actions */}
      <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 dark:text-slate-200">
        <div className="flex items-center space-x-2">
          <Folder className="h-4 w-4 text-amber-500 shrink-0" />
          <span>Directory Files ({selectedCount} of {totalFiles} selected)</span>
        </div>

        <div className="flex items-center space-x-2 text-[10px]">
          <button
            type="button"
            onClick={onSelectAll}
            className="flex items-center space-x-1 text-blue-600 dark:text-blue-400 hover:underline"
          >
            <CheckSquare className="h-3 w-3" />
            <span>All</span>
          </button>
          <span className="text-slate-300 dark:text-slate-600">|</span>
          <button
            type="button"
            onClick={onDeselectAll}
            className="flex items-center space-x-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:underline"
          >
            <Square className="h-3 w-3" />
            <span>None</span>
          </button>
        </div>
      </div>

      {/* Selected size indicator */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 px-1 font-mono">
        <span>Selected Payload:</span>
        <span className="text-emerald-600 dark:text-emerald-400 font-bold">
          {formatBytes(selectedSize)} / {formatBytes(totalSize)}
        </span>
      </div>

      {/* Interactive Tree View Box */}
      <div className="max-h-52 overflow-y-auto space-y-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-1.5 font-mono">
        {treeRoots.map((rootNode) => (
          <TreeNodeItem
            key={rootNode.path}
            node={rootNode}
            selectedPaths={selectedPaths}
            onTogglePath={onTogglePath}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    </div>
  );
};
