import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Clock, AlertCircle, Monitor, Package, Layers, Info, Code, Eye, EyeOff, FileJson, Bug, Zap, Activity, Settings, ChevronRight, ExternalLink, Copy, Filter, Search, Calendar, User, Globe, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { Button } from './ui/button';

interface CrashSummary {
  id: string;
  timestamp?: string;
  message?: string;
}

interface SentryStackFrame {
  function: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface MinidumpFrame {
  frame: number;
  trust: string;
  offset: string;
  module?: string;
  module_offset?: string;
  function?: string;
  function_offset?: string;
  file?: string;
  line?: number;
  registers?: Record<string, string>;
}

interface MinidumpThread {
  thread_id: number;
  thread_name?: string;
  frame_count: number;
  frames: MinidumpFrame[];
}

interface MinidumpAnalysis {
  crashing_thread: MinidumpThread;
  threads: MinidumpThread[];
}

interface Module {
  name: string;
  base_address: string;
  size: number;
  version: string;
}

interface CrashDetail {
  sentry_report: {
    event_id: string;
    level: string;
    message: string;
    platform: string;
    timestamp: string;
    stacktrace: {
      frames: SentryStackFrame[];
    };
  };
  minidump_summary?: {
    memory_regions: number;
    thread_count: number;
    modules: {
      count: number;
      list: Module[];
    };
    os: {
      cpu: string;
      family: string;
    };
    misc_info: {
      process_id: number;
      process_create_time: number;
      processor_current_mhz: number;
      processor_max_mhz: number;
    };
  };
  minidump_analysis?: MinidumpAnalysis;
}

const formatTimestamp = (timestamp: string) => {
  const date = new Date(parseFloat(timestamp) * 1000);
  return date.toLocaleString();
};

const formatBytes = (bytes: number) => {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
};

const projectRoot = '/Users/kaan/working/rust/crash/';

const isAppFrame = (frame: { filename?: string, file?: string}) => {
  const path = frame.filename || frame.file;
  return path && path.startsWith(projectRoot);
}

const formatPath = (path: string | undefined) => {
  if (!path) return 'unknown';
  return path.replace(projectRoot, 'app://');
}

const CrashViewer: React.FC = () => {
  const [crashes, setCrashes] = useState<CrashSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrashDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSystemFrames, setShowSystemFrames] = useState(false);

  // fetch list
  useEffect(() => {
    fetch('/crashes')
      .then((r) => r.json())
      .then(setCrashes)
      .catch((e) => setError(String(e)));
  }, []);

  // fetch detail when selected changes
  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    fetch(`/crash/${selected}`)
      .then((r) => r.json())
      .then(setDetail)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selected]);

  const renderStackTrace = (frames: (SentryStackFrame | MinidumpFrame)[]) => {
    const filteredFrames = showSystemFrames ? frames : frames.filter(isAppFrame);
    
    return (
      <div className="space-y-0 border rounded-lg overflow-hidden">
        {filteredFrames.map((frame, index) => {
          const isApp = isAppFrame(frame);
          const isMinidumpFrame = 'trust' in frame;
          
          const sentryFrame = !isMinidumpFrame ? frame as SentryStackFrame : undefined;
          const minidumpFrame = isMinidumpFrame ? frame as MinidumpFrame : undefined;
          
          const funcName = sentryFrame?.function || minidumpFrame?.function || '<unknown>';
          const filePath = sentryFrame?.filename || minidumpFrame?.file;
          const line = sentryFrame?.lineno || minidumpFrame?.line;
          const col = sentryFrame?.colno;
          const frameNum = frames.length - index;
          
          return (
            <div 
              key={index} 
              className={`border-b last:border-b-0 ${isApp ? 'bg-blue-50 dark:bg-blue-950/20' : 'bg-background hover:bg-muted/50'} transition-colors`}
            >
              <div className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground font-mono">#{frameNum}</span>
                      {isApp && <Badge variant="default" className="text-xs">App Frame</Badge>}
                      {minidumpFrame?.trust && (
                        <Badge variant="outline" className="text-xs">{minidumpFrame.trust}</Badge>
                      )}
                    </div>
                    <div className="font-mono text-sm font-medium text-foreground mb-1 break-all">
                      {funcName}
                    </div>
                    {filePath && (
                      <div className="text-xs text-muted-foreground font-mono break-all">
                        {formatPath(filePath)}
                        {line && <span className="text-blue-600 dark:text-blue-400">:{line}</span>}
                        {col && <span className="text-blue-600 dark:text-blue-400">:{col}</span>}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderModules = (modules: Module[]) => (
    <div className="space-y-2">
      {modules.map((module, index) => (
        <div key={index} className="border rounded-lg p-4 hover:bg-muted/50 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-sm font-medium mb-1 break-all">{module.name}</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Base: <span className="font-mono">{module.base_address}</span></div>
                <div>Size: <span className="font-mono">{formatBytes(module.size)}</span></div>
                {module.version && <div>Version: <span className="font-mono">{module.version}</span></div>}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderCrashHeader = (detail: CrashDetail) => (
    <div className="border-b bg-background">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/20 rounded-lg">
              <Bug className="w-6 h-6 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                {detail.sentry_report.message || 'Application Crash'}
              </h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatTimestamp(detail.sentry_report.timestamp)}
                </div>
                <div className="flex items-center gap-1">
                  <Globe className="w-4 h-4" />
                  {detail.sentry_report.platform}
                </div>
                <div className="flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" />
                  {detail.sentry_report.level}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <ExternalLink className="w-4 h-4 mr-2" />
              View Raw
            </Button>
            <Button variant="outline" size="sm">
              <Copy className="w-4 h-4 mr-2" />
              Copy ID
            </Button>
          </div>
        </div>
        
        {detail.minidump_summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Cpu className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">CPU</span>
              </div>
              <div className="text-sm font-mono">{detail.minidump_summary.os.cpu}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Threads</span>
              </div>
              <div className="text-sm font-mono">{detail.minidump_summary.thread_count}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Modules</span>
              </div>
              <div className="text-sm font-mono">{detail.minidump_summary.modules.count}</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <MemoryStick className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Process ID</span>
              </div>
              <div className="text-sm font-mono">{detail.minidump_summary.misc_info.process_id}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSidebar = () => (
    <div className="w-80 border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bug className="w-5 h-5" />
            Crash Reports
          </h2>
          <ThemeToggle />
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input 
            type="text" 
            placeholder="Search crashes..." 
            className="w-full pl-10 pr-4 py-2 text-sm border rounded-md bg-background"
          />
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2">
          {crashes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bug className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No crashes found</p>
            </div>
          ) : (
            crashes.map((crash) => (
              <div
                key={crash.id}
                onClick={() => setSelected(crash.id)}
                className={`p-3 rounded-lg cursor-pointer transition-colors mb-2 ${
                  selected === crash.id 
                    ? 'bg-primary/10 border border-primary/20' 
                    : 'hover:bg-muted/50 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span className="text-xs font-mono text-muted-foreground truncate">
                        {crash.id.slice(0, 8)}...
                      </span>
                    </div>
                    <p className="text-sm font-medium text-foreground truncate mb-1">
                      {crash.message || 'Application Crash'}
                    </p>
                    {crash.timestamp && (
                      <p className="text-xs text-muted-foreground">
                        {formatTimestamp(crash.timestamp)}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Error Loading Crashes</h2>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      {renderSidebar()}
      
      <div className="flex-1 flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Bug className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Select a Crash Report</h2>
              <p className="text-muted-foreground">Choose a crash from the sidebar to view details</p>
            </div>
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading crash details...</p>
            </div>
          </div>
        ) : detail ? (
          <div className="flex-1 flex flex-col">
            {renderCrashHeader(detail)}
            
            <div className="flex-1 p-6">
              <Tabs defaultValue="stacktrace" className="h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <TabsList>
                    <TabsTrigger value="stacktrace" className="flex items-center gap-2">
                      <Layers className="w-4 h-4" />
                      Stack Trace
                    </TabsTrigger>
                    {detail.minidump_summary && (
                      <TabsTrigger value="modules" className="flex items-center gap-2">
                        <Package className="w-4 h-4" />
                        Modules ({detail.minidump_summary.modules.count})
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="raw" className="flex items-center gap-2">
                      <FileJson className="w-4 h-4" />
                      Raw Data
                    </TabsTrigger>
                  </TabsList>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSystemFrames(!showSystemFrames)}
                      className="flex items-center gap-2"
                    >
                      {showSystemFrames ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      {showSystemFrames ? 'Hide' : 'Show'} System Frames
                    </Button>
                    <Button variant="outline" size="sm">
                      <Filter className="w-4 h-4 mr-2" />
                      Filter
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  <TabsContent value="stacktrace" className="h-full">
                    <ScrollArea className="h-full">
                      {renderStackTrace(detail.sentry_report.stacktrace.frames)}
                    </ScrollArea>
                  </TabsContent>

                  {detail.minidump_summary && (
                    <TabsContent value="modules" className="h-full">
                      <ScrollArea className="h-full">
                        {renderModules(detail.minidump_summary.modules.list)}
                      </ScrollArea>
                    </TabsContent>
                  )}

                  <TabsContent value="raw" className="h-full">
                    <ScrollArea className="h-full">
                      <pre className="text-xs bg-muted/50 p-4 rounded-lg overflow-auto">
                        {JSON.stringify(detail, null, 2)}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default CrashViewer; 