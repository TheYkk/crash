import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Clock, AlertCircle, Monitor, Package, Layers, Info, Code, Eye, EyeOff, FileJson } from 'lucide-react';
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
  // and a lot more fields that I might use later
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
  const [showSystemFrames, setShowSystemFrames] = useState(true);

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
  
    let lastModule: string | undefined = '';
  
    return (
      <div className="space-y-1">
        {filteredFrames.map((frame, index) => {
          const isApp = isAppFrame(frame);
          const isMinidumpFrame = 'trust' in frame;
          const module = isMinidumpFrame ? frame.module : undefined;
          const moduleChanged = module !== lastModule;
          lastModule = module;
  
          const sentryFrame = !isMinidumpFrame ? frame as SentryStackFrame : undefined;
          const minidumpFrame = isMinidumpFrame ? frame as MinidumpFrame : undefined;
  
          const funcName = sentryFrame?.function || minidumpFrame?.function || 'unknown';
          const filePath = sentryFrame?.filename || minidumpFrame?.file;
          const line = sentryFrame?.lineno || minidumpFrame?.line;
          const col = sentryFrame?.colno;
          const frameNum = frames.length - index;
          
          return (
            <React.Fragment key={index}>
              {moduleChanged && module && (
                <div className="flex items-center gap-2 pt-4 pb-2">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-muted-foreground">{module}</span>
                </div>
              )}
              <div className={`p-3 rounded-md ${isApp ? 'bg-primary/5' : ''}`}>
                <div className="flex items-center justify-between">
                  <div className="flex-1 space-y-1 overflow-hidden">
                    <code className={`font-medium truncate ${isApp ? 'text-primary' : 'text-foreground'}`}>
                      {funcName}
                    </code>
                    <div className="text-xs text-muted-foreground truncate">
                      {formatPath(filePath)}
                      {line && `:${line}`}
                      {col && `:${col}`}
                    </div>
                  </div>
                  <div className='flex items-center gap-2 pl-4'>
                    {isApp && <Badge variant="secondary">App</Badge>}
                    <Badge variant="outline">#{frameNum}</Badge>
                  </div>
                </div>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    );
  }

  const renderModules = (modules: Module[]) => (
    <div className="space-y-2">
      {modules.map((module, index) => (
        <Card key={index} className="p-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="font-medium text-sm">{module.name}</div>
              <div className="text-xs space-x-4 text-muted-foreground">
                <span>Base: {module.base_address}</span>
                <span>Size: {formatBytes(module.size)}</span>
                {module.version && <span>v{module.version}</span>}
              </div>
            </div>
            <Badge variant="secondary">
              <Package className="w-3 h-3 mr-1" />
              Module
            </Badge>
          </div>
        </Card>
      ))}
    </div>
  );
  
  const renderJson = (data: any) => (
    <Card>
      <CardContent className='p-0'>
        <ScrollArea className="h-[calc(100vh-480px)]">
          <pre className="text-xs p-4">
            {JSON.stringify(data, null, 2)}
          </pre>
        </ScrollArea>
      </CardContent>
    </Card>
  )


  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <div className="w-1/3 border-r border-border flex flex-col">
        <Card className="rounded-none border-0 border-b">
          <CardHeader>
            <div className='flex justify-between items-center'>
                <CardTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Crash Reports
                </CardTitle>
                <ThemeToggle />
            </div>
            <CardDescription>
              {crashes.length} crash{crashes.length !== 1 ? 'es' : ''} found
            </CardDescription>
          </CardHeader>
        </Card>
        <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
            {crashes.map((crash) => (
                <Card
                key={crash.id}
                className={`cursor-pointer transition-colors hover:bg-accent ${
                    selected === crash.id ? 'bg-accent border-primary' : ''
                }`}
                onClick={() => setSelected(crash.id)}
                >
                <CardContent className="p-4">
                    <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Badge variant="destructive">CRASH</Badge>
                        <div className="flex items-center text-xs text-muted-foreground">
                        <Clock className="w-3 h-3 mr-1" />
                        {crash.timestamp && formatTimestamp(crash.timestamp)}
                        </div>
                    </div>
                    <div className="font-mono text-xs truncate text-muted-foreground">
                        {crash.id}
                    </div>
                    <div className="text-sm font-medium line-clamp-2">
                        {crash.message || 'No message available'}
                    </div>
                    </div>
                </CardContent>
                </Card>
            ))}
            </div>
        </ScrollArea>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading crash details...</div>
          </div>
        )}

        {error && (
          <Card className="m-4">
            <CardContent className="p-6">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">Error: {error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {!selected && !loading && !error && (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>Select a crash report to view details</p>
            </div>
          </div>
        )}

        {detail && !loading && (
          <div className="h-full">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <AlertCircle className="w-6 h-6 text-destructive" />
                    Crash Report
                  </h1>
                  <p className="text-muted-foreground font-mono text-sm">
                    {detail.sentry_report.event_id}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="destructive" className="capitalize">
                    {detail.sentry_report.level}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {detail.sentry_report.platform}
                  </Badge>
                </div>
              </div>
              
              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4" />
                  <span className="font-medium">Error Message</span>
                </div>
                <p className="text-sm">{detail.sentry_report.message}</p>
                <div className="flex items-center mt-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatTimestamp(detail.sentry_report.timestamp)}
                </div>
              </div>
            </div>

            <div className="p-6">
              <Tabs defaultValue="stacktrace" className="h-[calc(100vh-300px)]">
                <TabsList className="grid w-full grid-cols-5">
                  <TabsTrigger value="stacktrace">Stack Trace</TabsTrigger>
                  <TabsTrigger value="modules">Modules</TabsTrigger>
                  <TabsTrigger value="system">System Info</TabsTrigger>
                  <TabsTrigger value="process">Process Info</TabsTrigger>
                  <TabsTrigger value="raw">Raw Data</TabsTrigger>
                </TabsList>

                <TabsContent value="stacktrace" className="h-full">
                  <Card className="h-full">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="flex items-center gap-2">
                                <Layers className="w-4 h-4" />
                                Stack Trace ({
                                  detail.minidump_analysis?.crashing_thread?.frames?.length ||
                                  detail.sentry_report?.stacktrace?.frames?.length || 0
                                } frames)
                            </CardTitle>
                            <Button variant="outline" size="sm" onClick={() => setShowSystemFrames(!showSystemFrames)}>
                                {showSystemFrames ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                                {showSystemFrames ? 'Hide' : 'Show'} System Frames
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[calc(100vh-480px)]">
                        {renderStackTrace(
                          detail.minidump_analysis?.crashing_thread?.frames ||
                          [...(detail.sentry_report?.stacktrace?.frames || [])].reverse()
                        )}
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>
                
                <TabsContent value="raw" className="h-full">
                  <Tabs defaultValue="sentry">
                    <TabsList>
                      <TabsTrigger value="sentry">Sentry Report</TabsTrigger>
                      <TabsTrigger value="minidump">Minidump Analysis</TabsTrigger>
                    </TabsList>
                    <TabsContent value="sentry">
                      {renderJson(detail.sentry_report)}
                    </TabsContent>
                    <TabsContent value="minidump">
                      {renderJson(detail.minidump_analysis)}
                    </TabsContent>
                  </Tabs>
                </TabsContent>

                <TabsContent value="modules" className="h-full">
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Package className="w-4 h-4" />
                        Loaded Modules ({detail.minidump_summary?.modules?.count || 0})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-[calc(100vh-480px)]">
                        {detail.minidump_summary?.modules?.list && 
                          renderModules(detail.minidump_summary.modules.list)}
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="system" className="h-full">
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Monitor className="w-4 h-4" />
                        System Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {detail.minidump_summary?.os && (
                        <div className="grid grid-cols-2 gap-4">
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Operating System</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.os.family}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">CPU Architecture</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.os.cpu}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Memory Regions</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.memory_regions}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Thread Count</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.thread_count}
                              </div>
                            </div>
                          </Card>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="process" className="h-full">
                  <Card className="h-full">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Info className="w-4 h-4" />
                        Process Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {detail.minidump_summary?.misc_info && (
                        <div className="grid grid-cols-2 gap-4">
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Process ID</div>
                              <div className="text-sm text-muted-foreground font-mono">
                                {detail.minidump_summary.misc_info.process_id}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Create Time</div>
                              <div className="text-sm text-muted-foreground">
                                {formatTimestamp(detail.minidump_summary.misc_info.process_create_time.toString())}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Current CPU MHz</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.misc_info.processor_current_mhz || 'N/A'}
                              </div>
                            </div>
                          </Card>
                          <Card className="p-4">
                            <div className="space-y-2">
                              <div className="font-medium">Max CPU MHz</div>
                              <div className="text-sm text-muted-foreground">
                                {detail.minidump_summary.misc_info.processor_max_mhz || 'N/A'}
                              </div>
                            </div>
                          </Card>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CrashViewer; 