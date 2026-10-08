/**
* 机构树形输出
*
* @export
* @interface OrgTreeOutput
*/
export interface OrgTreeOutput {
    /**
     * 主键Id
     *
     * @type {number}
     * @memberof OrgTreeOutput
     */
    id?: number;
    /**
     * 租户Id
     *
     * @type {number}
     * @memberof OrgTreeOutput
     */
    tenantId?: number;
    /**
     * 父Id
     *
     * @type {number}
     * @memberof OrgTreeOutput
     */
    pid?: number;
    /**
     * 名称
     *
     * @type {string}
     * @memberof OrgTreeOutput
     */
    name?: null | string;
    /**
     * 机构子项
     *
     * @type {Array<OrgTreeOutput>}
     * @memberof OrgTreeOutput
     */
    children?: Array<OrgTreeOutput> | null;
    /**
     * 是否禁止选中
     *
     * @type {boolean}
     * @memberof OrgTreeOutput
     */
    disabled?: boolean;
}
