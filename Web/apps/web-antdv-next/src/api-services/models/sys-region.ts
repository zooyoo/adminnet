/**
*
*
* @export
* @interface SysRegion
*/
export interface SysRegion {
    /**
     * @type {number}
     * @memberof SysRegion
     */
    id?: number;
    /**
     * @type {number}
     * @memberof SysRegion
     */
    pid?: number;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    name: string;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    shortName?: string | null;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    mergerName?: string | null;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    code?: string | null;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    zipCode?: string | null;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    cityCode?: string | null;
    /**
     * @type {number}
     * @memberof SysRegion
     */
    level?: number;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    pinYin?: string | null;
    /**
     * @type {number}
     * @memberof SysRegion
     */
    lng?: number;
    /**
     * @type {number}
     * @memberof SysRegion
     */
    lat?: number;
    /**
     * @type {number}
     * @memberof SysRegion
     */
    orderNo?: number;
    /**
     * @type {string}
     * @memberof SysRegion
     */
    remark?: string | null;
    /**
     * @type {Array<SysRegion>}
     * @memberof SysRegion
     */
    children?: Array<SysRegion> | null;
}
