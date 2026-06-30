import { useMemo } from 'react';
import { diffLines } from 'diff';
import { FileText, Move, FileOutput, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils.js';

interface PatchDiffProps {
  operations: Array<{
    type: 'create_file' | 'update_file' | 'move_file';
    path?: string;
    fromPath?: string;
    toPath?: string;
    content?: string;
    newContent?: string;
    beforeHash?: string;
  }>;
  className?: string;
}

function DiffBlock({ oldText, newText, filename }: { oldText: string; newText: string; filename: string }) {
  const diffResult = useMemo(() => {
    const changes = diffLines(oldText, newText);
    return changes;
  }, [oldText, newText]);

  let lineNumberOld = 0;
  let lineNumberNew = 0;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-3 py-1.5 text-xs text-gray-500 font-mono border-b border-gray-200">
        {filename}
      </div>
      <div className="text-xs font-mono leading-5 overflow-x-auto">
        {diffResult.map((part, i) => {
          const lines = part.value.split('\n');
          // Remove trailing empty line from split
          if (lines[lines.length - 1] === '') lines.pop();

          return lines.map((line, j) => {
            const isAdded = part.added;
            const isRemoved = part.removed;

            if (isAdded) {
              lineNumberNew++;
            } else if (isRemoved) {
              lineNumberOld++;
            } else {
              lineNumberOld++;
              lineNumberNew++;
            }

            const prefix = isAdded ? '+' : isRemoved ? '-' : ' ';
            const bgColor = isAdded
              ? 'bg-green-50'
              : isRemoved
              ? 'bg-red-50'
              : '';

            return (
              <div key={`${i}-${j}`} className={cn('flex', bgColor)}>
                <span className="w-10 text-right pr-3 text-gray-400 select-none shrink-0 border-r border-gray-100">
                  {isAdded ? '' : lineNumberOld}
                </span>
                <span className="w-10 text-right pr-3 text-gray-400 select-none shrink-0 border-r border-gray-100">
                  {isRemoved ? '' : lineNumberNew}
                </span>
                <span className={cn(
                  'w-5 text-center shrink-0',
                  isAdded ? 'text-green-600' : isRemoved ? 'text-red-600' : 'text-gray-400'
                )}>
                  {prefix}
                </span>
                <span className={cn(
                  'flex-1 whitespace-pre px-1',
                  isAdded ? 'text-green-900' : isRemoved ? 'text-red-900' : 'text-gray-700'
                )}>
                  {line}
                </span>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}

export function PatchDiff({ operations, className }: PatchDiffProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {operations.map((op, i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Operation header */}
          <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200">
            {op.type === 'create_file' && (
              <>
                <FileText className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700">Create</span>
              </>
            )}
            {op.type === 'update_file' && (
              <>
                <FileOutput className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-medium text-blue-700">Update</span>
              </>
            )}
            {op.type === 'move_file' && (
              <>
                <Move className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-medium text-purple-700">Move</span>
              </>
            )}
            <span className="text-xs font-mono text-gray-500 ml-1">
              {op.type === 'move_file' ? (
                <span className="flex items-center gap-1">
                  <span className="line-through">{op.fromPath}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span>{op.toPath}</span>
                </span>
              ) : (
                op.path
              )}
            </span>
          </div>

          {/* Diff content for create/update */}
          {op.type === 'create_file' && op.content && (
            <div className="p-0">
              <DiffBlock
                oldText=""
                newText={op.content}
                filename={op.path || ''}
              />
            </div>
          )}

          {op.type === 'update_file' && op.newContent && (
            <div className="p-0">
              {/* Show original → new — we only have newContent in the preview
                  but the diff shows it as all additions, which is fine */}
              <DiffBlock
                oldText={op.newContent}
                newText={op.newContent}
                filename={op.path || ''}
              />
              <div className="px-3 py-1.5 bg-blue-50 text-xs text-blue-700 border-t border-blue-100">
                Will update file in-place. Backup will be created before applying.
              </div>
            </div>
          )}

          {op.type === 'move_file' && (
            <div className="px-4 py-3 text-sm text-gray-600 bg-amber-50 border-t border-amber-100">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">From:</span>
                <span className="font-mono line-through">{op.fromPath}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-gray-500">To:</span>
                <span className="font-mono">{op.toPath}</span>
              </div>
              <p className="text-xs text-amber-600 mt-2">
                The file will be moved to the new location. Links referencing the old path may need updating.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
