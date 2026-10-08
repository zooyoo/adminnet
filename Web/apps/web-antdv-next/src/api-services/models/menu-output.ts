import { MenuTypeEnum } from './menu-type-enum';
import { StatusEnum } from './status-enum';
import { type SysMenuMeta } from './sys-menu-meta';
/**
* 系统菜单返回结果
*
* @export
* @interface MenuOutput
*/
export interface MenuOutput {
    /**
     * Id
     *
     * @type {number}
     * @memberof MenuOutput
     */
    id?: number;
    /**
     * 父Id
     *
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
     * 名称
     *
     * @type {string}
     * @memberof MenuOutput
     */
    name?: null | string;
    /**
     * 路由地址
     *
     * @type {string}
     * @memberof MenuOutput
     */
    path?: null | string;
    /**
     * 组件路径
     *
     * @type {string}
     * @memberof MenuOutput
     */
    component?: null | string;
    /**
     * 权限标识
     *
     * @type {string}
     * @memberof MenuOutput
     */
    permission?: null | string;
    /**
     * 重定向
     *
     * @type {string}
     * @memberof MenuOutput
     */
    redirect?: null | string;
    /**
     * 排序
     *
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
     * 备注
     *
     * @type {string}
     * @memberof MenuOutput
     */
    remark?: null | string;
    /**
     * 创建时间
     *
     * @type {Date}
     * @memberof MenuOutput
     */
    createTime?: Date;
    /**
     * 更新时间
     *
     * @type {Date}
     * @memberof MenuOutput
     */
    updateTime?: Date;
    /**
     * 创建者姓名
     *
     * @type {string}
     * @memberof MenuOutput
     */
    createUserName?: null | string;
    /**
     * 修改者姓名
     *
     * @type {string}
     * @memberof MenuOutput
     */
    updateUserName?: null | string;
    /**
     * @type {SysMenuMeta}
     * @memberof MenuOutput
     */
    meta?: SysMenuMeta;
    /**
     * 菜单子项
     *
     * @type {Array<MenuOutput>}
     * @memberof MenuOutput
     */
    children?: Array<MenuOutput> | null;
}
