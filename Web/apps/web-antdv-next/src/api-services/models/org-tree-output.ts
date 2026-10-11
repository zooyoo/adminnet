/**
*
*
* @export
* @interface OrgTreeOutput
*/
export interface OrgTreeOutput {
    /**
     * @type {number}
     * @memberof OrgTreeOutput
     */
    id?: number;
    /**
     * @type {number}
     * @memberof OrgTreeOutput
     */
    tenantId?: number;
    /**
     * @type {number}
     * @memberof OrgTreeOutput
     */
    pid?: number;
    /**
     * @type {string}
     * @memberof OrgTreeOutput
     */
    name?: string | null;
    /**
     * @type {Array<OrgTreeOutput>}
     * @memberof OrgTreeOutput
     */
    children?: Array<OrgTreeOutput> | null;
    /**
     * @type {boolean}
     * @memberof OrgTreeOutput
     */
    disabled?: boolean;
}
