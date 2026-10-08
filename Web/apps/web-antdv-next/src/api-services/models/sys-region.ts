/**
* 系统行政地区表
*
* @export
* @interface SysRegion
*/
export interface SysRegion {
    /**
     * 雪花Id
     *
     * @type {number}
     * @memberof SysRegion
     */
    id?: number;
    /**
     * 父Id
     *
     * @type {number}
     * @memberof SysRegion
     */
    pid?: number;
    /**
     * 名称
     *
     * @type {string}
     * @memberof SysRegion
     */
    name: string;
    /**
     * 简称
     *
     * @type {string}
     * @memberof SysRegion
     */
    shortName?: null | string;
    /**
     * 组合名
     *
     * @type {string}
     * @memberof SysRegion
     */
    mergerName?: null | string;
    /**
     * 行政代码
     *
     * @type {string}
     * @memberof SysRegion
     */
    code?: null | string;
    /**
     * 邮政编码
     *
     * @type {string}
     * @memberof SysRegion
     */
    zipCode?: null | string;
    /**
     * 区号
     *
     * @type {string}
     * @memberof SysRegion
     */
    cityCode?: null | string;
    /**
     * 层级
     *
     * @type {number}
     * @memberof SysRegion
     */
    level?: number;
    /**
     * 拼音
     *
     * @type {string}
     * @memberof SysRegion
     */
    pinYin?: null | string;
    /**
     * 经度
     *
     * @type {number}
     * @memberof SysRegion
     */
    lng?: number;
    /**
     * 维度
     *
     * @type {number}
     * @memberof SysRegion
     */
    lat?: number;
    /**
     * 排序
     *
     * @type {number}
     * @memberof SysRegion
     */
    orderNo?: number;
    /**
     * 备注
     *
     * @type {string}
     * @memberof SysRegion
     */
    remark?: null | string;
    /**
     * 机构子项
     *
     * @type {Array<SysRegion>}
     * @memberof SysRegion
     */
    children?: Array<SysRegion> | null;
}
