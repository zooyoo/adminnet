import { MenuTypeEnum } from './menu-type-enum';
import { StatusEnum } from './status-enum';
import { type SysMenuMeta } from './sys-menu-meta';
/**
*
*
* @export
* @interface MenuOutput
*/
export interface MenuOutput {
    /**
     * @type {number}
     * @memberof MenuOutput
     */
    id?: number;
    /**
     * @type {number}
     * @memberof MenuOutput
     */
    pid?: number;
    /**
     * @type {MenuTypeEnum}
     * @memberof MenuOutput
     */
    type?: MenuTypeEnum;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    name?: string | null;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    path?: string | null;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    component?: string | null;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    permission?: string | null;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    redirect?: string | null;
    /**
     * @type {number}
     * @memberof MenuOutput
     */
    orderNo?: number;
    /**
     * @type {StatusEnum}
     * @memberof MenuOutput
     */
    status?: StatusEnum;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    remark?: string | null;
    /**
     * @type {Date}
     * @memberof MenuOutput
     */
    createTime?: Date;
    /**
     * @type {Date}
     * @memberof MenuOutput
     */
    updateTime?: Date;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    createUserName?: string | null;
    /**
     * @type {string}
     * @memberof MenuOutput
     */
    updateUserName?: string | null;
    /**
     * @type {SysMenuMeta}
     * @memberof MenuOutput
     */
    meta?: SysMenuMeta;
    /**
     * @type {Array<MenuOutput>}
     * @memberof MenuOutput
     */
    children?: Array<MenuOutput> | null;
}
