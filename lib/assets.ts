import catalog from './asset-catalog.json';
export type AssetDefinition={id:string;name:string;category:string;url:string;thumbnail?:string;dimensions:[number,number,number];defaultRotation?:[number,number,number];sourceName:string;sourceUrl:string;description:string};
/** Envelope is a measured local, unscaled XYZ bounding box in millimetres.
 * It defines fit geometry; the displayed reference CAD retains its proportions. */
export type PlacedAsset={id:string;sourceId:string;name:string;visible:boolean;x:number;y:number;z:number;rx:number;ry:number;rz:number;scale:number;envelope?:[number,number,number]};
export const ASSET_CATALOG=catalog as AssetDefinition[];
export const assetDefinition=(id:string)=>ASSET_CATALOG.find(a=>a.id===id);
