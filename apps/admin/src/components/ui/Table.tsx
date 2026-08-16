import { type ReactNode } from 'react';

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    // Wide tables scroll inside their own box. The page itself never scrolls
    // sideways — on a tablet that turns every column into a guessing game.
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <th className={`px-3 py-2 font-medium ${className}`}>{children}</th>;
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top text-slate-800 ${className}`}>{children}</td>;
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="hover:bg-slate-50">{children}</tr>;
}
