/**
 * Loosely-typed Redfish resource shapes.
 *
 * The DMTF Redfish schema is huge and vendor-extended (Dell iDRAC, HPE iLO,
 * Lenovo XCC, Supermicro, etc. all add OEM properties). Rather than modeling
 * every schema, these types cover the properties in common use and fall back
 * to an index signature so callers can still reach vendor/OEM extensions.
 */

export interface ODataId {
  '@odata.id': string;
}

export interface ODataResource {
  '@odata.id': string;
  '@odata.type'?: string;
  '@odata.etag'?: string;
  Id?: string;
  Name?: string;
  Description?: string | null;
  [key: string]: unknown;
}

export interface RedfishCollection extends ODataResource {
  'Members@odata.count': number;
  'Members@odata.nextLink'?: string;
  Members: ODataId[];
}

export interface Status {
  State?: 'Enabled' | 'Disabled' | 'StandbyOffline' | 'StandbySpare' | 'InTest' | 'Starting' | 'Absent' | 'UnavailableOffline' | 'Deferring' | 'Quiesced' | 'Updating' | string;
  Health?: 'OK' | 'Warning' | 'Critical' | string | null;
  HealthRollup?: 'OK' | 'Warning' | 'Critical' | string | null;
}

export interface RedfishAction {
  target: string;
  title?: string;
  '@Redfish.ActionInfo'?: string;
  [key: string]: unknown;
}

export type ServiceRootActions = Record<string, RedfishAction | undefined>;

export interface ServiceRoot extends ODataResource {
  RedfishVersion?: string;
  UUID?: string;
  Systems?: ODataId;
  Chassis?: ODataId;
  Managers?: ODataId;
  Tasks?: ODataId;
  SessionService?: ODataId;
  AccountService?: ODataId;
  EventService?: ODataId;
  UpdateService?: ODataId;
  Registries?: ODataId;
  Links?: { Sessions?: ODataId; [key: string]: unknown };
}

export type PowerState = 'On' | 'Off' | 'PoweringOn' | 'PoweringOff' | string;

export type ResetType =
  | 'On'
  | 'ForceOn'
  | 'ForceOff'
  | 'ForceRestart'
  | 'GracefulShutdown'
  | 'GracefulRestart'
  | 'PowerCycle'
  | 'Nmi'
  | 'PushPowerButton'
  | 'Suspend'
  | 'Pause'
  | 'Resume';

export interface Boot {
  BootSourceOverrideEnabled?: 'Disabled' | 'Once' | 'Continuous' | string;
  BootSourceOverrideTarget?: string;
  BootSourceOverrideMode?: 'Legacy' | 'UEFI' | string;
  BootSourceOverrideTarget_RedfishAllowableValues?: string[];
  [key: string]: unknown;
}

export interface ComputerSystem extends ODataResource {
  SystemType?: string;
  Manufacturer?: string;
  Model?: string;
  SKU?: string;
  SerialNumber?: string;
  PartNumber?: string;
  AssetTag?: string | null;
  BiosVersion?: string;
  PowerState?: PowerState;
  Status?: Status;
  Boot?: Boot;
  ProcessorSummary?: { Count?: number; Model?: string; Status?: Status };
  MemorySummary?: { TotalSystemMemoryGiB?: number; Status?: Status };
  IndicatorLED?: string;
  Actions?: {
    '#ComputerSystem.Reset'?: RedfishAction & { 'ResetType@Redfish.AllowableValues'?: ResetType[] };
    [key: string]: unknown;
  };
  Links?: { Chassis?: ODataId[]; ManagedBy?: ODataId[]; [key: string]: unknown };
}

export interface Chassis extends ODataResource {
  ChassisType?: string;
  Manufacturer?: string;
  Model?: string;
  SerialNumber?: string;
  PartNumber?: string;
  Status?: Status;
  Power?: ODataId;
  Thermal?: ODataId;
  Actions?: { '#Chassis.Reset'?: RedfishAction; [key: string]: unknown };
  Links?: { ComputerSystems?: ODataId[]; ManagedBy?: ODataId[]; [key: string]: unknown };
}

export interface Manager extends ODataResource {
  ManagerType?: string;
  Manufacturer?: string;
  Model?: string;
  FirmwareVersion?: string;
  Status?: Status;
  PowerState?: PowerState;
  Actions?: {
    '#Manager.Reset'?: RedfishAction & { 'ResetType@Redfish.AllowableValues'?: ResetType[] };
    [key: string]: unknown;
  };
  Links?: { ManagerForServers?: ODataId[]; ManagerForChassis?: ODataId[]; [key: string]: unknown };
}

export interface PowerControl {
  MemberId?: string;
  Name?: string;
  PowerConsumedWatts?: number;
  PowerCapacityWatts?: number;
  Status?: Status;
  [key: string]: unknown;
}

export interface PowerSupply {
  MemberId?: string;
  Name?: string;
  PowerSupplyType?: string;
  LineInputVoltage?: number;
  LastPowerOutputWatts?: number;
  Status?: Status;
  [key: string]: unknown;
}

export interface Power extends ODataResource {
  PowerControl?: PowerControl[];
  PowerSupplies?: PowerSupply[];
  Voltages?: unknown[];
}

export interface Temperature {
  MemberId?: string;
  Name?: string;
  ReadingCelsius?: number | null;
  UpperThresholdCritical?: number | null;
  UpperThresholdFatal?: number | null;
  Status?: Status;
  [key: string]: unknown;
}

export interface Fan {
  MemberId?: string;
  Name?: string;
  Reading?: number | null;
  ReadingUnits?: string;
  Status?: Status;
  [key: string]: unknown;
}

export interface Thermal extends ODataResource {
  Temperatures?: Temperature[];
  Fans?: Fan[];
}

export interface Session extends ODataResource {
  UserName?: string;
}

export interface SessionService extends ODataResource {
  ServiceEnabled?: boolean;
  SessionTimeout?: number;
  Sessions?: ODataId;
}

export interface RedfishErrorPayload {
  error?: {
    code?: string;
    message?: string;
    '@Message.ExtendedInfo'?: Array<{ MessageId?: string; Message?: string; Severity?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
}
